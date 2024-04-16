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
  global.WebSocket = WebSocket;
}
import Debug from "debug";
import CommunicationClient from "./communicationclient.js";
import { v4 as uuid4 } from "uuid";
import endpointDefinition from "./_endpoint_definition.js";
import submodelSchemaDef from "./submodelschema.js";
import Ajv from "ajv";
const debug = Debug("asset");

export async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class BaseAsset {
  constructor(brokerIP, brokerPort, namespace, assetName, useSSL) {
    this.retainedTopics = new Set();
    this.client = new CommunicationClient();
    this.brokerIP = brokerIP;
    this.brokerPort = brokerPort;
    this.useSSL = useSSL;
    this.namespace = namespace;
    this.assetName = assetName;
  }

  async connect(options = {}) {
    debug("attempting to connect...");
    (options.clientId = this.assetName + "_" + uuid4()),
      await this.client.connect(
        this.brokerIP,
        this.brokerPort,
        this.useSSL,
        options
      );
    this.client.onConnectionLost((err) => {
      debug("Connection lost!!!! ", err);
    });
  }

  generateTopic(submodel, submodelElement, suffix) {
    let base = `${this.namespace}/${this.assetName}/${submodel}/${submodelElement}`;
    if (suffix) {
      base = base + "/" + suffix;
    }
    return base;
  }

  async _publish(topic, payload, qos = 0, retain = false) {
    if (retain) {
      this.retainedTopics.add(topic);
    }
    await this.client.publish(topic, JSON.stringify(payload), qos, retain);
  }

  async _subscribe(topic, callback) {
    await this.client.subscribe(topic, (message) => {
      try {
        callback(JSON.parse(message));
      } catch (e) {
        debug(e);
      }
    });
  }
}

export class ProxyAsset extends BaseAsset {
  constructor(brokerIP, brokerPort, namespace, assetName, useSSL = false) {
    super(brokerIP, brokerPort, namespace, assetName, useSSL);
    this.submodels = {};
  }

  async connect() {
    await super.connect();
    const submodels = await this._fetchSubmodels(
      this.namespace,
      this.assetName
    );
    this._createSubmodelStructure(submodels);
  }

  onPropertyChange(submodel, name, callback) {
    const topic = this.generateTopic(submodel, name);
    this._subscribe(topic, (prop) => {
      try {
        callback(prop);
      } catch (e) {
        debug(e);
      }
    });
  }

  async onEvent(submodel, name, callback) {
    const topic = this.generateTopic(submodel, name);
    await this._subscribe(topic, (message) => {
      try {
        callback(message.timestamp, message.params);
      } catch (e) {
        debug(e);
      }
    });
  }

  async callOperation(submodel, name, params, timeout = -1) {
    return await this.client.callOperation(
      this.namespace,
      this.assetName,
      submodel,
      name,
      params,
      timeout
    );
  }

  _createSubmodelStructure(submodels) {
    debug("creating structure for submodels:" + JSON.stringify(submodels));
    for (let [name, submodelDefinition] of Object.entries(submodels)) {
      let submodel = new Object();

      if (submodelDefinition.properties) {
        for (const [name, definition] of Object.entries(
          submodelDefinition.properties
        )) {
          Object.defineProperty(submodel, "on_" + name, {
            value: (callback) => {
              this.onPropertyChange(submodelDefinition.name, name, callback);
            },
            writable: false,
          });
        }
      }
      if (submodelDefinition.events) {
        for (const [name, definition] of Object.entries(
          submodelDefinition.events
        )) {
          Object.defineProperty(submodel, "on_" + name, {
            value: (callback) => {
              this.onEvent(submodelDefinition.name, name, callback);
            },
            writable: false,
          });
        }
      }
      if (submodelDefinition.operations) {
        for (const [name, definition] of Object.entries(
          submodelDefinition.operations
        )) {
          Object.defineProperty(submodel, name, {
            value: (params) => {
              return this.callOperation(submodelDefinition.name, name, params);
            },
            writable: false,
          });
        }
      }
      this[submodelDefinition.name] = submodel;
      this.submodels[submodelDefinition.name] = submodel;
    }
  }

  async _fetchSubmodels(namespace, assetName) {
    let submodels = {};
    const topic = `${namespace}/${assetName}/+/_meta`;
    function callback(message) {
      try {
        const definition = message["submodel_definition"];
        const name = definition.name;
        submodels[name] = definition;
      } catch (e) {
        if (message === "") {
          // someone deleted the message
          return;
        }
        debug("Could not parse", message);
      }
    }
    await this._subscribe(topic, callback);
    await wait(2000);
    await this.client.unsubscribe(topic, callback);
    return submodels;
  }
}

export class Asset extends BaseAsset {
  constructor(brokerIP, brokerPort, namespace, assetName, useSSL = false) {
    super(brokerIP, brokerPort, namespace, assetName, useSSL);
    this.healthy_topic = `${this.namespace}/${this.assetName}/_endpoint/healthy`;
    this.online_topic = `${this.namespace}/${this.assetName}/_endpoint/online`;
    this.log_topic = `${this.namespace}/${this.assetName}/_endpoint/log`;
  }

  async connect() {
    const config = {
      will: {
        topic: `${this.namespace}/${this.assetName}/_endpoint/online`,
        payload: "false",
        retain: true,
      },
    };
    await super.connect(config);
    this.setOnline();
    await this.registerAspect(endpointDefinition);
  }

  setHealthy(healthy) {
    this._publish(this.healthy_topic, healthy, 0, true);
  }

  setOnline() {
    this._publish(this.online_topic, true, 0, true);
  }

  log(message) {
    const payload = {
      timestamp: new Date().toISOString(),
      params: { entry: message },
    };
    if (this.client.isConnected()) {
      this._publish(this.log_topic, payload, 0, false);
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
    let submodelUrl =
      "https://raw.githubusercontent.com/boschresearch/assets2036-submodels/master/" +
      submodel.name +
      ".json";
    if (typeof submodel === "string") {
      //assume it was an URL (I know..)
      submodelUrl = submodel;
      submodel = await this._retrieveModel(submodel);
    }
    this._generateSubmodel(submodel);
    await this._publishMetaInfo(submodel, submodelUrl);
  }

  _generateSubmodel(submodelDefinition) {
    let submodel = new Object();

    if (submodelDefinition.properties) {
      for (const [name, definition] of Object.entries(
        submodelDefinition.properties
      )) {
        Object.defineProperty(submodel, name, {
          get: () => submodel["_" + name],
          set: (value) => {
            submodel["_" + name] = value;
            this.publishProperty(submodelDefinition.name, name, value);
          },
        });
      }
    }
    if (submodelDefinition.events) {
      for (const [name, definition] of Object.entries(
        submodelDefinition.events
      )) {
        Object.defineProperty(submodel, name, {
          value: (params) => {
            this.emitEvent(submodelDefinition.name, name, params);
          },
          writable: false,
        });
      }
    }
    if (submodelDefinition.operations) {
      for (const [name, definition] of Object.entries(
        submodelDefinition.operations
      )) {
        Object.defineProperty(submodel, "bind_" + name, {
          value: (callback) => {
            this.bindOperation(submodelDefinition.name, name, callback);
          },
          writable: false,
        });
      }
    }
    this[submodelDefinition.name] = submodel;
  }

  async _retrieveModel(submodelUrl) {
    const resp = await fetch(submodelUrl);
    const submodel = await resp.json();
    return submodel;
  }

  async _publishMetaInfo(submodelDefinition, submodelUrl) {
    const payload = {
      submodel_url: submodelUrl,
      submodel_definition: submodelDefinition,
      source: this.assetName,
    };
    const topic = this.generateTopic(submodelDefinition.name, "_meta");
    await this._publish(topic, payload, 0, true);
  }

  async emitEvent(submodelName, eventName, parameters) {
    const payload = {
      timestamp: new Date().toISOString(),
      params: parameters ? parameters : {},
    };
    debug("emitting", eventName, payload);
    if (this.client.isConnected()) {
      const topic = this.generateTopic(submodelName, eventName);
      await this._publish(topic, payload, 0, false);
      debug("emitted event", eventName);
    }
  }

  publishProperty(submodelName, propertyName, value) {
    if (this.client.isConnected()) {
      this._publish(
        this.generateTopic(submodelName, propertyName),
        value,
        0,
        true
      );
      debug("published Property", propertyName);
    }
  }

  async bindOperation(submodelName, operationName, callback) {
    const opReqTopic = this.generateTopic(submodelName, operationName, "REQ");
    debug("subscribing ", opReqTopic);
    await this._subscribe(opReqTopic, async (request) => {
      try {
        debug("Operation called: ", operationName);
        const response = callback(request.params);
        await this._publish(
          this.generateTopic(submodelName, operationName, "RESP"),
          {
            req_id: request.req_id,
            resp: response,
          },
          0,
          false
        );
      } catch (e) {
        debug(e);
      }
    });
    debug("Subscribed to ", opReqTopic);
  }

  async cleanup() {
    for (const topic of this.retainedTopics) {
      await this.client.publish(topic, "", 0, true);
    }
  }
}
export class AssetWatcher {
  constructor(brokerIP, brokerPort, useSSL = false) {
    this.brokerIP = brokerIP;
    this.brokerPort = brokerPort;
    this.useSSL = useSSL;
    this.client = new CommunicationClient();
    this.knownAssets = {};
    this.ajv = new Ajv({ strict: false });
    this._validate = this.ajv.compile(submodelSchemaDef);
  }

  async connect() {
    const options = {
      clientId: "assetWatcher_" + uuid4(),
    };
    return this.client.connect(
      this.brokerIP,
      this.brokerPort,
      this.useSSL,
      options
    );
  }

  _onAssetState(namespace, name, stateName, callback) {
    let states = {};
    let isGood = false;
    this.client.subscribe(`${namespace}/${name}/+/_meta`, (message, topic) => {
      // TODO fix this
      let submodelName = topic.split("/")[2];
      if (!(submodelName in states)) {
        states[submodelName] = false;
        this._onAssetSubmodelState(
          namespace,
          name,
          submodelName,
          stateName,
          (state) => {
            states[submodelName] = state;
            let allGood = Object.values(states).every((element) => element);
            if (allGood != isGood) {
              isGood = allGood;
              callback(allGood);
            }
          }
        );
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
    return [namespace, name];
  }

  _getEndpoint(assetNamespace, assetName, submodelName) {
    return new Promise((resolve, reject) => {
      if (`${assetNamespace}/${assetName}` in this.knownAssets) {
        const source =
          this.knownAssets[`${assetNamespace}/${assetName}`].submodels[
            submodelName
          ].source;
        if (typeof source === "undefined") {
          return null;
        }
        let [namespace, name] = this._extractEndpointName(
          source,
          assetNamespace
        );
        resolve({ namespace: namespace, name: name });
      } else {
        let topic = `${assetNamespace}/${assetName}/${submodelName}/_meta`;
        this.client.subscribe(topic, (message) => {
          try {
            const source = message.source;
            if (typeof source === "undefined") {
              return null;
            }
            let [namespace, name] = this._extractEndpointName(
              source,
              assetNamespace
            );
            this.client.unsubscribe(topic);
            resolve({ namespace: namespace, name: name });
          } catch (e) {
            debug(e);
          }
        });
      }
    });
  }

  onAssetSubmodelOnline(namespace, assetName, submodelName, callback) {
    this._onAssetSubmodelState(
      namespace,
      assetName,
      submodelName,
      "online",
      callback
    );
  }
  onAssetSubmodelHealthy(namespace, assetName, submodelName, callback) {
    this._onAssetSubmodelState(
      namespace,
      assetName,
      submodelName,
      "healthy",
      callback
    );
  }

  _onAssetSubmodelState(
    namespace,
    assetName,
    submodelName,
    stateName,
    callback
  ) {
    this._getEndpoint(namespace, assetName, submodelName).then((endpoint) => {
      if (endpoint === null) {
        debug(
          `Can't detect endpoint! ${namespace}/${assetName}/${submodelName} has no source defined`
        );
        return;
      }
      this._subscribe(
        `${endpoint.namespace}/${endpoint.name}/_endpoint/${stateName}`,
        (message) => {
          try {
            callback(message);
          } catch (e) {
            debug(e);
          }
        }
      );
    });
  }

  onAssetInfo(callback, namespace = "+", validate = true) {
    const discover_topic = `${namespace}/+/+/_meta`;
    this.client.subscribe(discover_topic, (message, topic) => {
      try {
        // TODO fix this
        const [assetNamespace, assetName, submodelName] = topic.split("/");
        const definition = JSON.parse(message);
        const fullAssetName = `${assetNamespace}/${assetName}`;
        if (!(fullAssetName in this.knownAssets)) {
          this.knownAssets[fullAssetName] = {
            namespace: assetNamespace,
            name: assetName,
            submodels: {},
          };
        }
        if (validate) {
          if (this._isValidMetaDefinition(definition)) {
            this.knownAssets[fullAssetName]["submodels"][submodelName] =
              definition;
            callback(this.knownAssets[fullAssetName]);
          } else {
            debug(
              "Invalid meta information for ",
              assetName,
              " in ",
              submodelName,
              ": "
            );
            debug(definition);
          }
        } else {
          this.knownAssets[fullAssetName]["submodels"][submodelName] =
            definition;
          callback(this.knownAssets[fullAssetName]);
        }
      } catch (e) {
        debug(e);
      }
    });
  }

  _isValidMetaDefinition(definition) {
    return [
      definition.submodel_url !== "",
      definition.source !== "",
      this._validate(definition.submodel_definition),
    ].reduce((a, b) => a && b);
  }
}

export async function discover(
  brokerIP,
  brokerPort,
  namespace,
  timeout = 4000,
  useSSL = false
) {
  let assets = [];
  const watcher = new AssetWatcher(brokerIP, brokerPort, useSSL);
  await watcher.connect();
  watcher.onAssetInfo((assetInfo) => {
    assets.push(assetInfo);
  }, namespace);
  await wait(timeout);
  return assets;
}
