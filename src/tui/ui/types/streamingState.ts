/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * State of streaming responses / UI input readiness.
 */
export enum StreamingState {
  Idle = 'idle',
  Responding = 'responding',
  WaitingForConfirmation = 'waiting_for_confirmation',
}
