/*
Copyright(c) 2016 - for information on the respective copyright owner
see the NOTICE file and / or the repository https://github.com/boschresearch/assets2036js.
#
Licensed under the Apache License, Version 2.0(the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
#
    http://www.apache.org/licenses/LICENSE-2.0
#
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const BROKER = "test.mosquitto.org";
const PORT = 8080;
import { expect, test, vi, assert } from "vitest";
import { Asset, ProxyAsset, discover, AssetWatcher, wait } from "./asset.js";

// Be the asset
test("properties", async () => {
  let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
  expect(asset).toBeDefined();
  await asset.connect();
  await asset.registerAspect(
    "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json"
  );
  console.log("creating proxy asset...");
  let proxyAsset = new ProxyAsset(BROKER, PORT, "arena2036", "jsTestAsset");
  await proxyAsset.connect();
  expect(proxyAsset.submodels).toHaveProperty("testmodel");
  console.log("proxy asset connected");

  const callbacks = {
    on_string_callback: function (value) {
      console.log("new string: ", value);
    },
    on_integer_callback: function (value) {
      console.log("new integer: ", value);
    },
  };

  const spy1 = vi.spyOn(callbacks, "on_string_callback");
  const spy3 = vi.spyOn(callbacks, "on_integer_callback");
  await proxyAsset.testmodel.on_string(callbacks.on_string_callback);
  await proxyAsset.testmodel.on_integer(callbacks.on_integer_callback);

  asset.testmodel.integer = 42;
  asset.testmodel.string = "hello, world!";

  await vi.waitUntil(() => spy1.mock.calls.length > 0, {
    timeout: 2000,
    interval: 200,
  });
  await vi.waitUntil(() => spy3.mock.calls.length > 0, {
    timeout: 2000,
    interval: 200,
  });
  expect(spy1).toHaveBeenCalled();
  expect(spy3).toHaveBeenCalled();
  asset.cleanup();
});
test("operations", async () => {
  let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
  await asset.connect();
  await asset.registerAspect(
    "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json"
  );
  let proxyAsset = new ProxyAsset(BROKER, PORT, "arena2036", "jsTestAsset");
  await proxyAsset.connect();
  expect(proxyAsset.submodels).toHaveProperty("testmodel");

  const callbacks = {
    setNumberCallback: function (value) {
      expect(value).toBe(42);
      return 42;
    },
  };

  const spy1 = vi.spyOn(callbacks, "setNumberCallback");

  await asset.testmodel.bind_setNumber(callbacks.setNumberCallback);

  const resp = await proxyAsset.testmodel.setNumber(42);
  expect(resp).toBe(42);
  expect(spy1).toHaveBeenCalled();
  asset.cleanup();
});
test("events", async () => {
  let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
  await asset.connect();
  await asset.registerAspect(
    "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json"
  );
  let proxyAsset = new ProxyAsset(BROKER, PORT, "arena2036", "jsTestAsset");
  await proxyAsset.connect();
  expect(proxyAsset.submodels).toHaveProperty("testmodel");

  const callbacks = {
    onEventCallback: function (timestamp, param_1) {
      expect(param_1).toBe(42);
    },
  };

  const spy1 = vi.spyOn(callbacks, "onEventCallback");

  await proxyAsset.testmodel.on_numberEvent(callbacks.onEventCallback);

  await asset.testmodel.numberEvent({ param_1: 42 });
  await vi.waitUntil(() => spy1.mock.calls.length > 0, {
    timeout: 2000,
    interval: 200,
  });
  expect(spy1).toHaveBeenCalled();
  asset.cleanup();
});
// Discover assets
test("discover assets", async () => {
  let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
  await asset.connect();
  await asset.registerAspect(
    "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json"
  );
  const assets = await discover(BROKER, PORT, "arena2036", 2000); // namespace '+' --> discover all
  console.log("assets found: ", assets.length);

  expect(assets.length).toBeGreaterThan(0);
  expect(assets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        namespace: "arena2036",
        name: "jsTestAsset",
      }),
    ])
  );

  asset.cleanup();
});

// Watch for new assets and submodels
test("watch assets", async () => {
  let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
  await asset.connect();
  await asset.registerAspect(
    "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json"
  );
  const watcher = new AssetWatcher(BROKER, PORT);
  await watcher.connect();
  const spy = vi.spyOn(watcher, "onAssetInfo");
  watcher.onAssetInfo((assetInfo) => {
    expect(assetInfo).toEqual(
      expect.objectContaining({
        namespace: "arena2036",
        name: "jsTestAsset",
      })
    );
  });
  await vi.waitUntil(() => spy.mock.calls.length > 0, {
    timeout: 2000,
    interval: 200,
  });
  expect(spy).toHaveBeenCalledTimes(1);
  asset.cleanup();
});

// watch online and healthy states
test("watch online and healthy states", async () => {
  let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
  await asset.connect();
  await asset.registerAspect(
    "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json"
  );
  const watcher = new AssetWatcher(BROKER, PORT);
  await watcher.connect();
  const spy1 = vi.spyOn(watcher, "onAssetSubmodelHealthy");
  const spy2 = vi.spyOn(watcher, "onAssetSubmodelOnline");
  watcher.onAssetSubmodelHealthy(
    "arena2036",
    "jsTestAsset",
    "testmodel",
    (healthy) => {
      expect(healthy).toBe(true);
    }
  );
  watcher.onAssetSubmodelOnline(
    "arena2036",
    "jsTestAsset",
    "testmodel",
    (online) => {
      expect(online).toBe(true);
    }
  );
  await vi.waitUntil(() => spy1.mock.calls.length > 0, {
    timeout: 2000,
    interval: 200,
  });
  await vi.waitUntil(() => spy2.mock.calls.length > 0, {
    timeout: 2000,
    interval: 200,
  });
  expect(spy1).toHaveBeenCalledTimes(1);
  expect(spy2).toHaveBeenCalledTimes(1);
  await asset.cleanup();
});
