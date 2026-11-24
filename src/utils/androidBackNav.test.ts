import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOpenOverlayForBack,
  resolveAndroidBackAction,
} from './androidBackNav';

test('resolveAndroidBackAction prioritizes topmost modal and overlays in order', () => {
  assert.equal(
    resolveAndroidBackAction({
      installGuideOpen: true,
      mobileSearchOpen: true,
      mobileDrawerOpen: true,
      alertsDrawerOpen: true,
      inspectorOpen: true,
    }),
    'close-install-guide'
  );

  assert.equal(
    resolveAndroidBackAction({
      installGuideOpen: false,
      mobileSearchOpen: true,
      mobileDrawerOpen: true,
      alertsDrawerOpen: true,
      inspectorOpen: true,
    }),
    'close-mobile-search'
  );

  assert.equal(
    resolveAndroidBackAction({
      installGuideOpen: false,
      mobileSearchOpen: false,
      mobileDrawerOpen: true,
      alertsDrawerOpen: true,
      inspectorOpen: true,
    }),
    'close-mobile-drawer'
  );

  assert.equal(
    resolveAndroidBackAction({
      installGuideOpen: false,
      mobileSearchOpen: false,
      mobileDrawerOpen: false,
      alertsDrawerOpen: true,
      inspectorOpen: true,
    }),
    'close-alerts-drawer'
  );

  assert.equal(
    resolveAndroidBackAction({
      installGuideOpen: false,
      mobileSearchOpen: false,
      mobileDrawerOpen: false,
      alertsDrawerOpen: false,
      inspectorOpen: true,
    }),
    'close-inspector'
  );
});

test('resolveAndroidBackAction returns exit-app when no overlay is open', () => {
  const empty = {
    installGuideOpen: false,
    mobileSearchOpen: false,
    mobileDrawerOpen: false,
    alertsDrawerOpen: false,
    inspectorOpen: false,
  };
  assert.equal(resolveAndroidBackAction(empty), 'exit-app');
  assert.equal(hasOpenOverlayForBack(empty), false);
  assert.equal(hasOpenOverlayForBack({ ...empty, inspectorOpen: true }), true);
});
