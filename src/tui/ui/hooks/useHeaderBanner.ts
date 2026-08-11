/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useBanner } from './useBanner.js';
import type { HiveConfig } from '../../config/hiveConfig.js';

export interface HeaderBannerData {
  defaultText: string;
  warningText: string;
}

export interface HeaderBannerState {
  bannerVisible: boolean;
  setBannerVisible: Dispatch<SetStateAction<boolean>>;
  bannerData: HeaderBannerData;
  bannerText: string;
}

/**
 * Custom hook to manage asynchronous header banner fetching, visibility, and data state.
 * Isolate banner lifecycle logic without imperative UI re-render dependencies.
 */
export function useHeaderBanner(config: HiveConfig): HeaderBannerState {
  const [defaultBannerText, setDefaultBannerText] = useState('');
  const [warningBannerText, setWarningBannerText] = useState('');
  const [bannerVisible, setBannerVisible] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchBannerTexts = async () => {
      try {
        const [defaultBanner, warningBanner] = await Promise.all([
          config.getBannerTextNoCapacityIssues(),
          config.getBannerTextCapacityIssues(),
        ]);

        if (isMounted) {
          setDefaultBannerText(defaultBanner || '');
          setWarningBannerText(warningBanner || '');
          setBannerVisible(true);
        }
      } catch {
        if (isMounted) {
          setDefaultBannerText('');
          setWarningBannerText('');
        }
      }
    };

    fetchBannerTexts();

    return () => {
      isMounted = false;
    };
  }, [config]);

  const bannerData = useMemo(
    () => ({
      defaultText: defaultBannerText,
      warningText: warningBannerText,
    }),
    [defaultBannerText, warningBannerText],
  );

  const { bannerText } = useBanner(bannerData);

  return {
    bannerVisible,
    setBannerVisible,
    bannerData,
    bannerText,
  };
}
