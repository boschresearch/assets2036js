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
import { Asset, ProxyAsset, discover, AssetWatcher } from "./asset.js";
import Debug from "debug";
const debug = Debug("test_asset");

debug("Starting the tests")

function getBool() {
    debug("getBool called");
    return false;
}
// Be the asset

(async _ => {
    debug("Publish an asset to " + BROKER);
    let asset = new Asset(BROKER, PORT, "arena2036", "jsTestAsset", false);
    debug("asset created!");
    await asset.connect()
    debug("Connected! Registering asset...");
    await asset.registerAspect(
        "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/testmodel.json");
    debug("Registration done");
    asset.setHealthy(true);
    asset.testmodel.bind_getBool(getBool);
    asset.testmodel.bind_setNumber(num => debug("Received ", num));
    asset.testmodel.integer = 42;
    debug("create proxy asset");
    let proxyAsset = new ProxyAsset(BROKER, PORT, "arena2036", "jsTestAsset");
    await proxyAsset.connect();
    debug("Proxy asset connected!");
    let resp = await proxyAsset.testmodel.setNumber({ "param_1": 42 });
    debug(resp);
    proxyAsset.testmodel.on_string(value => { debug("new string: ", value) });
    proxyAsset.testmodel.on_numberEvent((timestamp, params) => { debug("new event: ", timestamp, params) });




    asset.testmodel.numberEvent({ param1: 44 });

    await new Promise((resolve, reject) => {
        setInterval(_ => resolve(), 20000);
        debug(".");
    });

    asset.cleanup();
})().catch(error => debug(error));



// Discover assets
(async _ => {
    const assets = await discover(BROKER, PORT, "+"); // namespace '+' --> discover all
    debug("assets found: ", assets.length);
    debug(assets);
})();

// Watch for new assets and submodels

const watcher = new AssetWatcher(BROKER, PORT);
watcher.connect().then(_ => {
    watcher.onAssetInfo(assetInfo => debug(assetInfo));
    debug("registered watcher");
});


// watch online and healthy states
const ohwatcher = new AssetWatcher(BROKER, PORT);
ohwatcher.connect().then(_ => {
    debug("Connected");
    ohwatcher.onAssetSubmodelHealthy("arena2036", "200A", "tracked_location", healthy => debug("is healthy: ", healthy));
    ohwatcher.onAssetSubmodelOnline("arena2036", "200A", "tracked_location", online => debug("is online: ", online));
});