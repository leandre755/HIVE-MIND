/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { formatDuration } from '../utils/formatters.js';
import {
  calculateAverageLatency,
  calculateCacheHitRate,
  calculateErrorRate,
} from '../utils/computeStats.js';
import { useSessionStats, type ModelMetrics } from '../contexts/SessionContext.js';
import { Table, type Column } from './Table.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { getDisplayString, isAutoModel, LlmRole, tokenLimit } from '../contexts/UIStateContext.js';
import { getProviderStatus } from '../utils/providerStatus.js';

interface StatRowData {
  metric: string;
  isSection?: boolean;
  isSubtle?: boolean;
  [key: string]: string | React.ReactNode | boolean | undefined | number;
}

interface ModelStatsDisplayProps {
  currentModel?: string;
}

function getUsageColor(usagePercent: number): string {
  if (usagePercent >= 80) return theme.status.error;
  if (usagePercent >= 60) return theme.status.warning;
  return theme.text.primary;
}

const buildStatsRows = (
  activeModels: [string, ModelMetrics][],
  hasCached: boolean,
  hasThoughts: boolean,
  hasTool: boolean,
  allRoles: LlmRole[],
): StatRowData[] => {
  const createRow = (
    metric: string,
    getValue: (metrics: ModelMetrics, modelName: string) => string | React.ReactNode,
    options: { isSection?: boolean; isSubtle?: boolean } = {},
  ): StatRowData => {
    const row: StatRowData = { metric, isSection: options.isSection, isSubtle: options.isSubtle };
    activeModels.forEach(([name, metrics]) => {
      Reflect.set(row, name, getValue(metrics, name));
    });
    return row;
  };
  const rows: StatRowData[] = [];
  rows.push({ metric: 'API', isSection: true });
  rows.push(createRow('Requests', (m) => m.api.totalRequests.toLocaleString()));
  rows.push(
    createRow('Errors', (m) => {
      const errorRate = calculateErrorRate(m);
      return (
        <Text color={m.api.totalErrors > 0 ? theme.status.error : theme.text.primary}>
          {m.api.totalErrors.toLocaleString()} ({errorRate.toFixed(1)}%)
        </Text>
      );
    }),
  );
  rows.push(createRow('Avg Latency', (m) => formatDuration(calculateAverageLatency(m))));
  rows.push({ metric: '' });
  rows.push({ metric: 'Tokens', isSection: true });
  rows.push(
    createRow('Total', (m) => (
      <Text color={theme.text.secondary}>{m.tokens.total.toLocaleString()}</Text>
    )),
  );
  rows.push(
    createRow(
      'Input',
      (m) => <Text color={theme.text.primary}>{m.tokens.input.toLocaleString()}</Text>,
      { isSubtle: true },
    ),
  );
  if (hasCached) {
    rows.push(
      createRow(
        'Cache Reads',
        (m) => {
          const cacheHitRate = calculateCacheHitRate(m);
          return (
            <Text color={theme.text.secondary}>
              {m.tokens.cached.toLocaleString()} ({cacheHitRate.toFixed(1)}%)
            </Text>
          );
        },
        { isSubtle: true },
      ),
    );
  }
  if (hasThoughts) {
    rows.push(
      createRow(
        'Thoughts',
        (m) => <Text color={theme.text.primary}>{m.tokens.thoughts.toLocaleString()}</Text>,
        { isSubtle: true },
      ),
    );
  }
  if (hasTool) {
    rows.push(
      createRow(
        'Tool',
        (m) => <Text color={theme.text.primary}>{m.tokens.tool.toLocaleString()}</Text>,
        { isSubtle: true },
      ),
    );
  }
  rows.push(
    createRow(
      'Output',
      (m) => <Text color={theme.text.primary}>{m.tokens.candidates.toLocaleString()}</Text>,
      { isSubtle: true },
    ),
  );
  rows.push(
    createRow(
      'Context Limit',
      (_m, name) => {
        const limit = tokenLimit(name);
        return <Text color={theme.text.secondary}>{limit.toLocaleString()}</Text>;
      },
      { isSubtle: true },
    ),
  );
  rows.push(
    createRow(
      'Context Usage',
      (m, name) => {
        const limit = tokenLimit(name);
        const usagePercent = limit > 0 ? (m.tokens.input / limit) * 100 : 0;
        return <Text color={getUsageColor(usagePercent)}>{usagePercent.toFixed(1)}%</Text>;
      },
      { isSubtle: true },
    ),
  );
  if (allRoles.length > 0) {
    rows.push({ metric: '' });
    rows.push({ metric: 'Roles', isSection: true });
    allRoles.forEach((role) => {
      rows.push({ metric: role, isSection: true });
      const addRoleMetric = (
        metric: string,
        getValue: (r: NonNullable<ModelMetrics['roles']>[string]) => string | React.ReactNode,
      ) => {
        const row: StatRowData = { metric, isSubtle: true };
        activeModels.forEach(([name, metrics]) => {
          const roleMetrics = Reflect.get(metrics.roles ?? {}, role);
          Reflect.set(
            row,
            name,
            roleMetrics ? getValue(roleMetrics) : <Text color={theme.text.secondary}>-</Text>,
          );
        });
        rows.push(row);
      };
      addRoleMetric('Requests', (r) => r.totalRequests.toLocaleString());
      addRoleMetric('Input', (r) => (
        <Text color={theme.text.primary}>{(r.tokens?.input ?? 0).toLocaleString()}</Text>
      ));
      addRoleMetric('Output', (r) => (
        <Text color={theme.text.primary}>{(r.tokens?.candidates ?? 0).toLocaleString()}</Text>
      ));
      addRoleMetric('Cache Reads', (r) => (
        <Text color={theme.text.secondary}>{(r.tokens?.cached ?? 0).toLocaleString()}</Text>
      ));
    });
  }
  return rows;
};

export const ModelStatsDisplay: React.FC<ModelStatsDisplayProps> = ({ currentModel }) => {
  const { stats } = useSessionStats();

  const { models } = stats.metrics;
  const settings = useSettings();
  const showUserIdentity = settings.merged.ui.showUserIdentity;
  const providerStatus = useMemo(() => getProviderStatus(), []);
  const activeModels = (Object.entries(models) as unknown as [string, ModelMetrics][]).filter(
    ([, metrics]) => metrics.api?.totalRequests > 0,
  );

  if (activeModels.length === 0) {
    return (
      <Box borderStyle="round" borderColor={theme.border.default} paddingTop={1} paddingX={2}>
        <Text color={theme.text.primary}>No API calls have been made in this session.</Text>
      </Box>
    );
  }

  const modelNames = activeModels.map(([name]) => name);

  const hasThoughts = activeModels.some(([, metrics]) => metrics.tokens.thoughts > 0);
  const hasTool = activeModels.some(([, metrics]) => metrics.tokens.tool > 0);
  const hasCached = activeModels.some(([, metrics]) => metrics.tokens.cached > 0);

  const allRoles = [
    ...new Set(activeModels.flatMap(([, metrics]) => Object.keys(metrics.roles ?? {}))),
  ]
    .filter((role): role is LlmRole => {
      const validRoles: string[] = Object.values(LlmRole);
      return validRoles.includes(role);
    })
    .sort((a, b) => {
      if (a === b) return 0;
      if (a === LlmRole.MAIN) return -1;
      if (b === LlmRole.MAIN) return 1;
      return a.localeCompare(b);
    });

  const rows = buildStatsRows(activeModels, hasCached, hasThoughts, hasTool, allRoles);

  const columns: Array<Column<StatRowData>> = [
    {
      key: 'metric',
      header: 'Metric',
      width: 28,
      renderCell: (row) => (
        <Text bold={row.isSection} color={row.isSection ? theme.text.primary : theme.text.link}>
          {row.isSubtle ? `  ↳ ${row.metric}` : row.metric}
        </Text>
      ),
    },
    ...modelNames.map((name) => ({
      key: name,
      header: getDisplayString(name),
      flexGrow: 1,
      renderCell: (row: StatRowData) => {
        // Don't render anything for section headers in model columns
        if (row.isSection) return null;
        const val = Reflect.get(row, name) as string | React.ReactNode | number | undefined;
        if (val === undefined || val === null) return null;
        if (typeof val === 'string' || typeof val === 'number') {
          return <Text color={theme.text.primary}>{val}</Text>;
        }
        return val as React.ReactNode;
      },
    })),
  ];

  const isAuto = currentModel && isAutoModel(currentModel);
  const statsTitle = isAuto
    ? `${getDisplayString(currentModel)} Stats For Nerds`
    : 'Model Stats For Nerds';

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingTop={1}
      paddingX={2}
    >
      <Text bold color={theme.text.accent}>
        {statsTitle}
      </Text>
      <Box height={1} />

      {showUserIdentity && (
        <Box>
          <Box width={28}>
            <Text color={theme.text.link}>AI Providers:</Text>
          </Box>
          <Text
            color={theme.text.primary}
          >{`${providerStatus.activeFamilies}/${providerStatus.totalFamilies} active (${providerStatus.totalKeys} keys)`}</Text>
        </Box>
      )}
      {showUserIdentity && <Box height={1} />}

      <Table data={rows} columns={columns} />
    </Box>
  );
};
