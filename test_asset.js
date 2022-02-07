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

import { Asset, ProxyAsset, discover, AssetWatcher } from "./asset.js";
import Debug from "debug";
const debug = Debug("test_asset");

function getBool() {
    debug("getBool called");
    return false;
}

// Be the asset

(async _ => {
    let asset = new Asset("192.168.100.3", 8282, "arena2036", "jsTestAsset");
    await asset.connect()
    debug("Connected!");
    await asset.registerAsset(
        "https://arena2036-infrastructure.saz.bosch-si.com/arena2036_public/assets2036_submodels/-/raw/master/testmodel.json");
    debug("Registration done");
    asset.setHealthy(true);
    asset.testmodel.bind_getBool(getBool);
    asset.testmodel.integer = 42;
    asset.testmodel.boolEvent({ param1: true });

    await new Promise((resolve, reject) => {
        setInterval(_ => resolve(), 2000);
    });

    asset.cleanup();
})().catch(error => debug(error));

// Use an asset
(async _ => {
    let proxyAsset = new ProxyAsset("192.168.100.3", 8282, "arena2036", "test_asset");
    await proxyAsset.connect();
    let resp = await proxyAsset.testmodel.setNumber({ "param_1": 42 });
    debug(resp);
    proxyAsset.testmodel.on_string(value => { debug("new string: ", value) });
    proxyAsset.testmodel.on_numberEvent((timestamp, params) => { debug("new event: ", timestamp, params) });
})();
// Discover assets
(async _ => {
    const assets = await discover("192.168.100.3", 8282, "+"); // namespace '+' --> discover all
    debug("assets found: ", assets.length);
    debug(assets);
})();

// Watch for new assets and submodels

const watcher = new AssetWatcher("192.168.100.3", 8282);
watcher.connect().then(_ => {
    watcher.onAssetInfo(assetInfo => debug(assetInfo));
    debug("registered watcher");
});


// watch online and healthy states
const ohwatcher = new AssetWatcher("192.168.100.3", 8282);
ohwatcher.connect().then(_ => {
    debug("Connected");
    ohwatcher.onAssetSubmodelHealthy("arena2036", "200A", "tracked_location", healthy => debug("is healthy: ", healthy));
    ohwatcher.onAssetSubmodelOnline("arena2036", "200A", "tracked_location", online => debug("is online: ", online));
});