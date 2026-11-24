export interface AndroidBackState {
  installGuideOpen: boolean;
  mobileSearchOpen: boolean;
  mobileDrawerOpen: boolean;
  alertsDrawerOpen: boolean;
  inspectorOpen: boolean;
}

export type AndroidBackAction =
  | 'close-install-guide'
  | 'close-mobile-search'
  | 'close-mobile-drawer'
  | 'close-alerts-drawer'
  | 'close-inspector'
  | 'exit-app';

/**
 * Resolves the highest-priority overlay to dismiss when the user presses
 * the Android hardware/gesture Back button.
 */
export function resolveAndroidBackAction(state: AndroidBackState): AndroidBackAction {
  if (state.installGuideOpen) return 'close-install-guide';
  if (state.mobileSearchOpen) return 'close-mobile-search';
  if (state.mobileDrawerOpen) return 'close-mobile-drawer';
  if (state.alertsDrawerOpen) return 'close-alerts-drawer';
  if (state.inspectorOpen) return 'close-inspector';
  return 'exit-app';
}

export function hasOpenOverlayForBack(state: AndroidBackState): boolean {
  return resolveAndroidBackAction(state) !== 'exit-app';
}
