#!/usr/bin/env python3
"""Verifies security invariants of GitHub Actions workflow files in target repository.

This script relies exclusively on the Python standard library to run both
locally and in CI maintenance workflows. It inspects workflows to block dangerous
configurations (untrusted triggers, overly permissive scopes, unbounded parallel
runs, unpinned actions) without requiring external heavy YAML parsers.
"""

from __future__ import annotations

import codecs
import re
import sys
from pathlib import Path

SHA = re.compile(r"^[0-9a-f]{40}$")
USES = re.compile(r"^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(.+))?\s*$")
PERSIST_CREDENTIALS_TRUE = re.compile(r"^\s*persist-credentials:\s*true\b(?:\s*#.*)?$")
TOP_KEY = re.compile(r"^([^:\s][^:]*):\s*(.*)$")
ANCHOR_DEF = re.compile(r"(?:^|\s)&([A-Za-z0-9_-]+)(?:\s+(.*))?$")


def fail(message: str) -> None:
    print(f"ERROR: {message}")


def strip_comment(line: str) -> str:
    """Strips end-of-line YAML comments while preserving quotes."""
    single = double = escaped = False
    for idx, char in enumerate(line):
        if escaped:
            escaped = False
        elif double and char == "\\":
            escaped = True
        elif char == "'" and not double:
            single = not single
        elif char == '"' and not single:
            double = not double
        elif char == "#" and not single and not double:
            return line[:idx].rstrip()
    return line.rstrip()


def yaml_key(raw: str) -> str:
    """Decodes potentially quoted or anchored YAML keys."""
    key = re.sub(r"^&[A-Za-z0-9_-]+\s+", "", raw.strip())
    if len(key) >= 2 and key[0] == key[-1] and key[0] in "\"'":
        inner = key[1:-1]
        if key[0] == '"':
            try:
                return codecs.decode(inner, "unicode_escape")
            except ValueError:
                return inner
        return inner
    return key


def split_flow(content: str) -> list[str]:
    """Splits flow-style YAML collections at nesting depth 0."""
    items: list[str] = []
    current: list[str] = []
    depth = 0
    single = double = escaped = False
    for char in content:
        if escaped:
            escaped = False
        elif double and char == "\\":
            escaped = True
            continue
        elif char == "'" and not double:
            single = not single
        elif char == '"' and not single:
            double = not double
        elif not single and not double:
            if char in "[{":
                depth += 1
            elif char in "]}":
                depth -= 1
            elif char == "," and depth == 0:
                item = "".join(current).strip()
                if item:
                    items.append(item)
                current = []
                continue
        current.append(char)
    tail = "".join(current).strip()
    if tail:
        items.append(tail)
    return items


def flow_complete(value: str) -> bool:
    """Returns whether a flow-style YAML collection is properly closed."""
    depth = 0
    single = double = escaped = saw_bracket = False
    for char in value:
        if escaped:
            escaped = False
        elif double and char == "\\":
            escaped = True
        elif char == "'" and not double:
            single = not single
        elif char == '"' and not single:
            double = not double
        elif not single and not double:
            if char in "[{":
                depth += 1
                saw_bracket = True
            elif char in "]}":
                depth -= 1
    return saw_bracket and depth == 0


def flow_pair_key(pair: str) -> str | None:
    """Extracts key from flow-style key/value pair at depth 0."""
    depth = 0
    single = double = escaped = False
    for idx, char in enumerate(pair):
        if escaped:
            escaped = False
        elif double and char == "\\":
            escaped = True
        elif char == "'" and not double:
            single = not single
        elif char == '"' and not single:
            double = not double
        elif not single and not double:
            if char in "[{":
                depth += 1
            elif char in "]}":
                depth -= 1
            elif char == ":" and depth == 0:
                return pair[:idx].strip()
    return None


def resolve_token(token: str, anchors: dict[str, set[str]]) -> set[str]:
    """Resolves trigger token from scalar or anchor alias."""
    tok = token.strip().lstrip("-").strip()
    if not tok:
        return set()
    if tok.startswith("*"):
        return anchors.get(tok[1:].strip(), set())
    return {yaml_key(tok)}


def flow_triggers(flow: str, anchors: dict[str, set[str]]) -> set[str]:
    """Extracts trigger events from closed flow-style collection."""
    trimmed = flow.strip()
    triggers: set[str] = set()
    if trimmed.startswith("[") and trimmed.endswith("]"):
        for item in split_flow(trimmed[1:-1]):
            triggers.update(resolve_token(item, anchors))
    elif trimmed.startswith("{") and trimmed.endswith("}"):
        for pair in split_flow(trimmed[1:-1]):
            key = flow_pair_key(pair)
            if key:
                triggers.add(yaml_key(key))
    return triggers


def child_lines(lines: list[str], start: int) -> list[str]:
    """Returns indented lines below start line until dedent."""
    parent_indent = len(lines[start]) - len(lines[start].lstrip(" "))
    collected: list[tuple[int, str]] = []
    for line in lines[start + 1:]:
        code = strip_comment(line).rstrip()
        if not code.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent <= parent_indent:
            break
        collected.append((indent, code))
    if not collected:
        return []
    base = min(indent for indent, _ in collected)
    return [code for indent, code in collected if indent == base]


def collect_anchors(lines: list[str]) -> dict[str, set[str]]:
    """Collects YAML anchors defining trigger lists/mappings."""
    anchors: dict[str, set[str]] = {}
    for idx, line in enumerate(lines):
        code = strip_comment(line).rstrip()
        match = ANCHOR_DEF.search(code)
        if not match:
            continue
        name, value = match.group(1), (match.group(2) or "").strip()
        if value.startswith(("[", "{")):
            joined = value
            cursor = idx
            while not flow_complete(joined) and cursor + 1 < len(lines):
                cursor += 1
                joined = f"{joined} {strip_comment(lines[cursor]).strip()}"
            if flow_complete(joined):
                anchors[name] = flow_triggers(joined, anchors)
            continue
        if value and not value.startswith(("&", "*")):
            anchors[name] = resolve_token(value, anchors)
            continue
        triggers: set[str] = set()
        for child in child_lines(lines, idx):
            stripped = child.strip()
            if stripped.startswith("-") or stripped.startswith("*"):
                triggers.update(resolve_token(stripped, anchors))
            else:
                key = flow_pair_key(stripped)
                triggers.add(yaml_key(key if key is not None else stripped))
        anchors[name] = triggers
    return anchors


def parse_triggers(lines: list[str]) -> set[str]:
    """Extracts trigger events from top-level 'on:' section."""
    anchors = collect_anchors(lines)
    for idx, line in enumerate(lines):
        if len(line) - len(line.lstrip(" ")) != 0:
            continue
        code = strip_comment(line)
        match = TOP_KEY.match(code.strip())
        if not match or yaml_key(match.group(1)) != "on":
            continue
        inline = match.group(2).strip()
        if inline.startswith(("[", "{")):
            joined = inline
            cursor = idx
            while not flow_complete(joined) and cursor + 1 < len(lines):
                cursor += 1
                joined = f"{joined} {strip_comment(lines[cursor]).strip()}"
            if flow_complete(joined):
                return flow_triggers(joined, anchors)
            return set()
        if inline and not inline.startswith("&"):
            return resolve_token(inline, anchors)
        if inline.startswith("*"):
            return resolve_token(inline, anchors)
        triggers: set[str] = set()
        for child in child_lines(lines, idx):
            stripped = child.strip()
            if stripped.startswith("-") or stripped.startswith("*"):
                triggers.update(resolve_token(stripped, anchors))
                continue
            key = flow_pair_key(stripped)
            triggers.add(yaml_key(key if key is not None else stripped))
        return triggers
    return set()


def top_level_entries(lines: list[str]) -> list[tuple[int, str, str]]:
    """Lists top-level key/value pairs excluding comments."""
    entries: list[tuple[int, str, str]] = []
    for number, line in enumerate(lines, start=1):
        if len(line) - len(line.lstrip(" ")) != 0:
            continue
        match = TOP_KEY.match(strip_comment(line).strip())
        if match:
            entries.append((number, yaml_key(match.group(1)), match.group(2).strip()))
    return entries


def check_workflow(path: Path) -> int:
    errors = 0
    lines = path.read_text(encoding="utf-8").splitlines()
    text = "\n".join(strip_comment(line) for line in lines)

    # 1. Untrusted triggers: pull_request_target exposes secrets to PR code.
    if re.search(r"^\s*pull_request_target\s*:", text, flags=re.MULTILINE):
        fail(f"{path}: pull_request_target is strictly prohibited in this starter kit.")
        errors += 1

    # 2. Permissions: mandatory top-level block, write-all prohibited.
    has_permissions = False
    for number, key, value in top_level_entries(lines):
        if key == "permissions":
            has_permissions = True
            if re.match(r"^(write-all|write)\b", value):
                fail(f"{path}:{number}: permissions '{value}' prohibited (least privilege required).")
                errors += 1
    if not has_permissions:
        fail(f"{path}: missing top-level permissions block.")
        errors += 1

    # 3. Concurrency: mandatory group for PR/push triggers.
    triggers = parse_triggers(lines)
    if triggers.intersection({"pull_request", "push"}) and not has_concurrency_group(lines):
        fail(f"{path}: top-level concurrency block with 'group:' required for triggers "
             f"{', '.join(sorted(triggers.intersection({'pull_request', 'push'})))}.")
        errors += 1

    # 4. Jobs: each job must specify runs-on and timeout-minutes.
    for message_number, message in missing_job_directives(lines):
        fail(f"{path}:{message_number}: {message}")
        errors += 1

    # 5. Credentials and action pinning.
    for number, line in enumerate(lines, start=1):
        if PERSIST_CREDENTIALS_TRUE.match(line):
            fail(f"{path}:{number}: persist-credentials: true is prohibited by default.")
            errors += 1
        match = USES.match(line)
        if not match:
            continue
        action, ref, comment = match.groups()
        if action.startswith("./") or action.startswith("docker://"):
            continue
        if not SHA.fullmatch(ref):
            fail(f"{path}:{number}: {action}@{ref} must be pinned to a 40-character SHA.")
            errors += 1
        elif not comment or not comment.startswith("v"):
            print(f"WARNING: {path}:{number}: add a version comment, e.g., '# v4.0.0'.")
    return errors


def has_concurrency_group(lines: list[str]) -> bool:
    """Verifies that top-level concurrency block carries a non-empty group."""
    for number, line in enumerate(lines):
        if len(line) - len(line.lstrip(" ")) != 0:
            continue
        code = strip_comment(line)
        match = TOP_KEY.match(code.strip())
        if not match or yaml_key(match.group(1)) != "concurrency":
            continue
        inline = match.group(2).strip()
        if inline:
            if inline.startswith("{"):
                joined = inline
                cursor = number - 1
                while not flow_complete(joined) and cursor + 1 < len(lines):
                    cursor += 1
                    joined = f"{joined} {strip_comment(lines[cursor]).strip()}"
                if flow_complete(joined):
                    for pair in split_flow(joined.strip()[1:-1]):
                        key = flow_pair_key(pair)
                        if key and yaml_key(key) == "group":
                            value = pair.split(":", 1)[1].strip() if ":" in pair else ""
                            if value:
                                return True
                return False
            return True
        for child in child_lines(lines, number):
            child_match = re.match(r"^([^:]+):\s*(\S.*)$", child.strip())
            if child_match and yaml_key(child_match.group(1)) == "group":
                return True
        return False
    return False


def missing_job_directives(lines: list[str]) -> list[tuple[int, str]]:
    """Returns missing runs-on/timeout-minutes directives for each job."""
    problems: list[tuple[int, str]] = []
    jobs_start = None
    for number, key, value in top_level_entries(lines):
        if key == "jobs":
            jobs_start = number
            if value:
                return [(number, "the 'jobs:' section must map job objects, not scalar values.")]
            break
    if jobs_start is None:
        return []

    job_headers: list[tuple[int, int, str]] = []
    job_indent: int | None = None
    for number, line in enumerate(lines[jobs_start:], start=jobs_start + 1):
        indent = len(line) - len(line.lstrip(" "))
        code = strip_comment(line).rstrip()
        if not code.strip():
            continue
        if indent <= 0:
            break
        header = re.match(r"^([^:\s][^:]*):\s*(?:#.*)?$", code.strip())
        if header and (job_indent is None or indent == job_indent):
            job_indent = indent
            job_headers.append((number, indent, yaml_key(header.group(1))))

    if not job_headers:
        return [(jobs_start, "no jobs defined under 'jobs:' section.")]

    for position, (header_line, indent, job_name) in enumerate(job_headers):
        end = job_headers[position + 1][0] - 1 if position + 1 < len(job_headers) else len(lines)
        block = [
            (number, strip_comment(line).rstrip())
            for number, line in enumerate(lines[header_line:end], start=header_line + 1)
            if strip_comment(line).strip()
        ]
        direct = [entry for entry in block if len(entry[1]) - len(entry[1].lstrip(" ")) > indent]
        if not direct:
            continue
        prop_indent = min(
            len(code) - len(code.lstrip(" ")) for _, code in direct
        )
        has_timeout = any(
            re.match(r"^(?:\"timeout-minutes\"|'timeout-minutes'|timeout-minutes):\s*(?:\d+|\$\{\{.+?\}\})\s*$",
                     code.strip())
            for _, code in direct
            if len(code) - len(code.lstrip(" ")) == prop_indent
        )
        has_runs_on = any(
            re.match(r"^(?:\"runs-on\"|'runs-on'|runs-on):\s*\S", code.strip())
            for _, code in direct
            if len(code) - len(code.lstrip(" ")) == prop_indent
        )
        if not has_runs_on:
            problems.append((header_line, f"job '{job_name}': missing 'runs-on:' directive."))
        if not has_timeout:
            problems.append((header_line, f"job '{job_name}': missing 'timeout-minutes:' directive."))
    return problems


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(".github/workflows")
    if not root.is_dir():
        print(f"ERROR: directory not found: {root}")
        return 2

    workflows = sorted([*root.glob("*.yml"), *root.glob("*.yaml")])
    if not workflows:
        print(f"ERROR: no YAML workflows found in: {root}")
        return 2

    errors = sum(check_workflow(path) for path in workflows)
    if errors:
        print(f"Validation failed: {errors} error(s) detected.")
        return 1
    print(f"Validation succeeded: {len(workflows)} workflow(s) compliant.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
