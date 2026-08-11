/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import ansiEscapes from 'ansi-escapes';
import process from 'node:process';

/**
 * TerminalScreenService encapsulating low-level imperative terminal E/S operations.
 * Isolates ansiEscapes, buffer switches, line wrapping, mouse modes, and stdout manipulation.
 */
export class TerminalScreenService {
  /**
   * Clears the terminal screen using ANSI escape codes.
   * @param stdout - Optional custom output stream (defaults to process.stdout)
   */
  public static clearTerminal(stdout: NodeJS.WriteStream = process.stdout): void {
    try {
      stdout.write(ansiEscapes.clearTerminal);
    } catch {
      // Ignore stream write errors if process is exiting or detached
    }
  }

  /**
   * Writes arbitrary string data to stdout safely.
   * @param data - The string to write
   * @param stdout - Optional custom output stream (defaults to process.stdout)
   */
  public static writeToStdout(data: string, stdout: NodeJS.WriteStream = process.stdout): void {
    try {
      stdout.write(data);
    } catch {
      // Ignore stream write errors
    }
  }

  /**
   * Enters the alternate terminal screen buffer (\x1b[?1049h).
   * @param stdout - Optional custom output stream
   */
  public static enterAlternateScreen(stdout: NodeJS.WriteStream = process.stdout): void {
    this.writeToStdout(ansiEscapes.enterAlternativeScreen, stdout);
  }

  /**
   * Exits the alternate terminal screen buffer (\x1b[?1049l).
   * @param stdout - Optional custom output stream
   */
  public static exitAlternateScreen(stdout: NodeJS.WriteStream = process.stdout): void {
    this.writeToStdout(ansiEscapes.exitAlternativeScreen, stdout);
  }

  /**
   * Enables terminal mouse tracking events.
   * @param stdout - Optional custom output stream
   */
  public static enableMouseEvents(stdout: NodeJS.WriteStream = process.stdout): void {
    // SGR Mouse tracking escape sequences
    this.writeToStdout('\x1b[?1000h\x1b[?1002h\x1b[?1015h\x1b[?1006h', stdout);
  }

  /**
   * Disables terminal mouse tracking events.
   * @param stdout - Optional custom output stream
   */
  public static disableMouseEvents(stdout: NodeJS.WriteStream = process.stdout): void {
    this.writeToStdout('\x1b[?1000l\x1b[?1002l\x1b[?1015l\x1b[?1006l', stdout);
  }

  /**
   * Enables automatic terminal line wrapping.
   * @param stdout - Optional custom output stream
   */
  public static enableLineWrapping(stdout: NodeJS.WriteStream = process.stdout): void {
    this.writeToStdout('\x1b[?7h', stdout);
  }

  /**
   * Disables automatic terminal line wrapping.
   * @param stdout - Optional custom output stream
   */
  public static disableLineWrapping(stdout: NodeJS.WriteStream = process.stdout): void {
    this.writeToStdout('\x1b[?7l', stdout);
  }

  /**
   * Determines whether alternate screen buffer should be active based on configuration.
   * @param isAlternateBuffer - User preference for alternate screen
   * @param screenReader - Whether screen reader accessibility mode is active
   */
  public static shouldEnterAlternateScreen(
    isAlternateBuffer = false,
    screenReader = false,
  ): boolean {
    if (screenReader) {
      return false;
    }
    return Boolean(isAlternateBuffer);
  }
}
