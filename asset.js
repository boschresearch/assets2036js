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

import WebSocket from "isomorphic-ws";
if (typeof global !== "undefined") {
    global.WebSocket = WebSocket
}
import Debug from 'debug';
import CommunicationClient from "./communicationclient.js";
import axios from "axios";
import https from "https";
import { v4 as uuid4 } from "uuid";
import endpointDefinition from "./_endpoint_definition.js";
import submodelSchemaDef from "./submodelschema.js";
import { Validator } from "jsonschema";


const debug = Debug("asset");

class BaseAsset {
    constructor(brokerIP, brokerPort, namespace, assetName, useSSL) {
        this.client = new CommunicationClient(brokerIP, brokerPort, useSSL, assetName + "_" + uuid4());
        this.namespace = namespace;
        this.client.onConnectionLost(err => {
            debug("Connection lost!!!! ", err);
        });
        this.assetName = assetName;
    }

    async connect() {

        debug("attempting to connect...");
        return this.client.connect();

    }

    generateTopic(submodel, submodelElement, suffix) {
        let base = `${this.namespace}/${this.assetName}/${submodel}/${submodelElement}`;
        if (suffix) {
            base = base + "/" + suffix;
        }
        return base;
    }
}

export class ProxyAsset extends BaseAsset {
    constructor(brokerIP, brokerPort, namespace, assetName, useSSL = false) {
        super(brokerIP, brokerPort, namespace, assetName, useSSL);
        this.submodels = {};

    }

    async connect() {
        await super.connect();
        const submodels = await this._fetchSubmodels(this.namespace, this.assetName);
        this._createSubmodelStructure(submodels);

    }

    onPropertyChange(submodel, name, callback) {
        const topic = this.generateTopic(submodel, name)
        this.client.subscribe(topic, message => {
            try {
                callback(JSON.parse(message.payloadString));
            } catch (e) {
                debug(e);
            }

        });
    }

    onEvent(submodel, name, callback) {
        const topic = this.generateTopic(submodel, name);
        this.client.subscribe(topic, message => {
            try {
                const payload = JSON.parse(message.payloadString)
                callback(payload.timestamp, payload.params);
            } catch (e) {
                debug(e);
            }
        });
    }

    async callOperation(submodel, name, params) {
        debug("Calling operation " + name);
        const req_id = uuid4();
        return new Promise((resolve, reject) => {
            const resp_topic = this.generateTopic(submodel, name, "RESP");
            this.client.subscribe(resp_topic, message => {
                try {
                    const payload = JSON.parse(message.payloadString);
                    if (payload.req_id === req_id) {
                        this.client.unsubscribe(resp_topic);
                        resolve(payload.resp);
                    }
                } catch (e) {
                    debug(e);
                }
            });
            const req_payload = {
                "req_id": req_id,
                "params": typeof params === "undefined" ? {} : params
            }
            const topic = this.generateTopic(submodel, name, "REQ")
            this.client.publish(topic, JSON.stringify(req_payload));
            debug("Published to ", topic);
        });
    }

    _createSubmodelStructure(submodels) {
        debug("creating structure for submodels:" + JSON.stringify(submodels));
        for (let [name, submodelDefinition] of Object.entries(submodels)) {

            let submodel = new Object();

            if (submodelDefinition.properties) {
                for (const [name, definition] of Object.entries(submodelDefinition.properties)) {
                    Object.defineProperty(submodel, "on_" + name, {
                        value: (callback) => { this.onPropertyChange(submodelDefinition.name, name, callback) },
                        writable: false
                    });
                }
            }
            if (submodelDefinition.events) {
                for (const [name, definition] of Object.entries(submodelDefinition.events)) {
                    Object.defineProperty(submodel, "on_" + name, {
                        value: (callback) => {
                            this.onEvent(submodelDefinition.name, name, callback);
                        },
                        writable: false

                    });
                }
            }
            if (submodelDefinition.operations) {
                for (const [name, definition] of Object.entries(submodelDefinition.operations)) {
                    Object.defineProperty(submodel, name, {

                        value: (params) => {
                            return this.callOperation(submodelDefinition.name, name, params);
                        }, writable: false
                    });
                }
            }
            this[submodelDefinition.name] = submodel;
            this.submodels[submodelDefinition.name] = submodel;

        }
    }

    _fetchSubmodels(namespace, assetName) {
        let submodels = {}
        return new Promise((resolve, reject) => {
            const topic = `${namespace}/${assetName}/+/_meta`;
            this.client.subscribe(topic, message => {
                try {
                    const definition = JSON.parse(message.payloadString)["submodel_definition"];
                    const name = definition.name;
                    submodels[name] = definition;
                }
                catch (e) {
                    if (message.payloadString === "") {
                        // someone deleted the message 
                        return;
                    }
                    debug("Could not parse", message.payloadString, "from", message.destinationName);
                }

            });
            debug("subscribed to _meta topics");
            setTimeout(_ => { resolve(submodels) }, 2000);
        });

    }


}
export class Asset extends BaseAsset {
    constructor(brokerIP, brokerPort, namespace, assetName, useSSL = false) {
        super(brokerIP, brokerPort, namespace, assetName, useSSL);
        this.healthy_topic = `${this.namespace}/${this.assetName}/_endpoint/healthy`;
        this.online_topic = `${this.namespace}/${this.assetName}/_endpoint/online`;
        this.log_topic = `${this.namespace}/${this.assetName}/_endpoint/log`;
        this.retainedTopics = new Set();
    }

    async connect() {
        const config = {
            "willMessage": { "topic": `${this.namespace}/${this.assetName}/_endpoint/online`, "payload": "false" },
            "onSuccess": _ => {
                debug("Connected to broker.");


            }
        }
        await this.client.connect(config);
        this.setOnline();
        await this.registerAspect(endpointDefinition);
    }

    setHealthy(healthy) {
        this._publish(this.healthy_topic, healthy, true);
    }

    setOnline() {
        this._publish(this.online_topic, true, true);
    }

    log(message) {
        const payload = {
            "timestamp": new Date().toISOString(),
            "params": { "entry": message }
        }
        if (this.client.isConnected()) {
            this._publish(this.log_topic, payload);
            debug("emitting log: ", message);
        }
    }


    generateTopic(submodel, submodelElement, suffix) {
        let base = `${this.namespace}/${this.assetName}/${submodel}/${submodelElement}`;
        if (suffix) {
            base = base + "/" + suffix;
        }
        return base;
    }

    async registerAspect(submodel) {
        let submodelUrl = "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/" + submodel.name + ".json";
        if (typeof submodel === "string") {
            //assume it was an URL (I know..)
            submodelUrl = submodel;
            submodel = await this._retrieveModel(submodel);
        }
        this._generateSubmodel(submodel)
        this._publishMetaInfo(submodel, submodelUrl);
    }

    _generateSubmodel(submodelDefinition) {
        let submodel = new Object();

        if (submodelDefinition.properties) {
            for (const [name, definition] of Object.entries(submodelDefinition.properties)) {
                Object.defineProperty(submodel, name, {
                    get: () => submodel["_" + name],
                    set: (value) => {
                        submodel["_" + name] = value;
                        this.publishProperty(submodelDefinition.name, name, value);
                    }
                });
            }
        }
        if (submodelDefinition.events) {
            for (const [name, definition] of Object.entries(submodelDefinition.events)) {
                Object.defineProperty(submodel, name, {
                    value: (params) => {
                        this.emitEvent(submodelDefinition.name, name, params);
                    },
                    writable: false

                });
            }
        }
        if (submodelDefinition.operations) {
            for (const [name, definition] of Object.entries(submodelDefinition.operations)) {
                Object.defineProperty(submodel, "bind_" + name, {

                    value: (callback) => {
                        this.bindOperation(submodelDefinition.name, name, callback);
                    }, writable: false
                });
            }
        }
        this[submodelDefinition.name] = submodel;
    }

    async _retrieveModel(submodelUrl) {
        return axios.get(submodelUrl, {
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }).then(resp => {
            debug("fetched submodel");
            return resp.data;
        }).catch(error => { debug(error) });
    }

    _publishMetaInfo(submodelDefinition, submodelUrl) {
        const payload = {
            "submodel_url": submodelUrl,
            "submodel_definition": submodelDefinition,
            "source": this.assetName
        };
        const topic = this.generateTopic(submodelDefinition.name, "_meta")
        this._publish(topic, payload, true);
    }

    emitEvent(submodelName, eventName, parameters) {
        const payload = {
            "timestamp": new Date().toISOString(),
            "params": parameters
        }
        debug("emitting", eventName, payload);
        if (this.client.isConnected()) {
            this._publish(this.generateTopic(submodelName, eventName), payload);
            debug("emitted event", eventName);
        }
    }

    publishProperty(submodelName, propertyName, value) {
        if (this.client.isConnected()) {
            this._publish(this.generateTopic(submodelName, propertyName), value, true);
            debug("published Property", propertyName);
        }
    }

    bindOperation(submodelName, operationName, callback) {
        const opReqTopic = this.generateTopic(submodelName, operationName, "REQ")
        debug("subscribing ", opReqTopic);
        this.client.subscribe(opReqTopic, (req) => {
            try {
                debug("Operation called: ", operationName);
                let request = JSON.parse(req.payloadString);
                const response = callback(request.params);
                this._publish(this.generateTopic(submodelName, operationName, "RESP"),
                    {
                        "req_id": request.req_id,
                        "resp": response
                    }
                );
            } catch (e) {
                debug(e);
            }

        });
        debug("Subscribed to ", opReqTopic);
    }

    _publish(topic, payload, retain = false) {
        if (retain) {
            this.retainedTopics.add(topic);
        }
        this.client.publish(topic, JSON.stringify(payload), retain);
    }

    cleanup() {
        for (const topic of this.retainedTopics) {
            this.client.publish(topic, "", true);
        }
    }
}
export class AssetWatcher {

    constructor(brokerIP, brokerPort, useSSL = false) {
        this.client = new CommunicationClient(brokerIP, brokerPort, useSSL, "assetwatcher_" + uuid4());
        this.knownAssets = {};
        this.validator = new Validator();
    }

    async connect() {
        return this.client.connect();
    }


    _onAssetState(namespace, name, stateName, callback) {
        let states = {};
        let isGood = false;
        this.client.subscribe(`${namespace}/${name}/+/_meta`, message => {
            let submodelName = message.destinationName.split("/")[2];
            if (!(submodelName in states)) {
                states[submodelName] = false;
                this._onAssetSubmodelState(namespace, name, submodelName, stateName, (state) => {
                    states[submodelName] = state;
                    let allGood = Object.values(states).every(element => element);
                    if (allGood != isGood) {
                        isGood = allGood;
                        callback(allGood);
                    }
                });
            }
        });
    }

    onAssetOnline(namespace, name, callback) {
        this._onAssetState(namespace, name, "online", callback);
    }

    onAssetHealthy(namespace, name, callback) {
        this._onAssetState(namespace, name, "healthy", callback);
    }

    _extractEndpointName(source, assetNamespace) {
        let [namespace, name] = source.split("/");
        if (typeof name === "undefined") {
            name = namespace;
            namespace = assetNamespace;
        }
        return [namespace, name]
    }

    _getEndpoint(assetNamespace, assetName, submodelName) {
        return new Promise((resolve, reject) => {
            if (`${assetNamespace}/${assetName}` in this.knownAssets) {
                const source = this.knownAssets[`${assetNamespace}/${assetName}`].submodels[submodelName].source;
                if (typeof source === "undefined") {
                    return null;
                }
                let [namespace, name] = this._extractEndpointName(source, assetNamespace);
                resolve({ "namespace": namespace, "name": name });
            } else {
                let topic = `${assetNamespace}/${assetName}/${submodelName}/_meta`;
                this.client.subscribe(topic, message => {
                    try {
                        const source = JSON.parse(message.payloadString).source;
                        if (typeof source === "undefined") {
                            return null;
                        }
                        let [namespace, name] = this._extractEndpointName(source, assetNamespace);
                        this.client.unsubscribe(topic)
                        resolve({ "namespace": namespace, "name": name });
                    } catch (e) {
                        debug(e);
                    }

                });
            }
        });
    }

    onAssetSubmodelOnline(namespace, assetName, submodelName, callback) {
        this._onAssetSubmodelState(namespace, assetName, submodelName, "online", callback);
    }
    onAssetSubmodelHealthy(namespace, assetName, submodelName, callback) {
        this._onAssetSubmodelState(namespace, assetName, submodelName, "healthy", callback);
    }

    _onAssetSubmodelState(namespace, assetName, submodelName, stateName, callback) {
        this._getEndpoint(namespace, assetName, submodelName).then(endpoint => {
            if (endpoint === null) {
                debug(`Can't detect endpoint! ${namespace}/${assetName}/${submodelName} has no source defined`);
                return;
            }
            this.client.subscribe(`${endpoint.namespace}/${endpoint.name}/_endpoint/${stateName}`, message => {
                try {
                    callback(JSON.parse(message.payloadString));
                } catch (e) {
                    debug(e);
                }
            });
        });
    }

    onAssetInfo(callback, namespace = "+", validate = true) {
        const discover_topic = `${namespace}/+/+/_meta`;
        this.client.subscribe(discover_topic, message => {
            try {
                const assetNamespace = message.destinationName.split("/")[0];
                const assetName = message.destinationName.split("/")[1];
                const submodelName = message.destinationName.split("/")[2];
                const definition = JSON.parse(message.payloadString);
                const fullAssetName = `${assetNamespace}/${assetName}`;
                if (!(fullAssetName in this.knownAssets)) {
                    this.knownAssets[fullAssetName] = {
                        "namespace": assetNamespace,
                        "name": assetName,
                        "submodels": {}
                    };
                }
                if (validate) {
                    if (this._isValidMetaDefinition(definition)) {
                        this.knownAssets[fullAssetName]["submodels"][submodelName] = definition;
                        callback(this.knownAssets[fullAssetName]);
                    } else {
                        debug("Invalid meta information for ", assetName, " in ", submodelName, ": ");
                        debug(definition);
                    }
                } else {
                    this.knownAssets[fullAssetName]["submodels"][submodelName] = definition;
                    callback(this.knownAssets[fullAssetName]);
                }
            } catch (e) {
                debug(e);
            }
        });
    }

    _isValidMetaDefinition(definition) {
        try {
            return [
                definition.submodel_url !== "",
                definition.source !== "",
                this.validator.validate(definition.submodel_definition, submodelSchemaDef, { throwFirst: true }).valid
            ].reduce((a, b) => a && b);
        } catch (e) {
            debug("Error in validating Meta information: ", e);
            return false;
        }
    }
}


export async function discover(brokerIP, brokerPort, namespace, timeout = 4000, useSSL = false) {
    let assets = [];
    return new Promise((resolve, reject) => {
        const watcher = new AssetWatcher(brokerIP, brokerPort, useSSL);
        watcher.connect().then(_ => {
            watcher.onAssetInfo(assetInfo => {
                assets.push(assetInfo);
            }, namespace);
            setTimeout(_ => {
                debug("discovery stopping.")
                resolve(assets);
            }, timeout);
        });
    });
}