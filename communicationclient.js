import PahoMqtt from "paho-mqtt";
import { v4 as uuidv4 } from "uuid";
import Debug from "debug";
const debug = Debug("communicationclient");

function is_match(topic, wildcard_topic) {
    const topic_token = topic.split("/");
    const wildcard_topic_token = wildcard_topic.split("/");
    for (let i = 0; i < topic_token.length; i++) {
        if (wildcard_topic_token[i] === "#") {
            return true;
        }
        if (
            topic_token[i] !== wildcard_topic_token[i] &&
            wildcard_topic_token[i] !== "+"
        ) {
            return false;
        }
    }
    return true;
}

export default class {
    constructor(broker_url, broker_port, useSSL, client_id) {
        this.callbacks = {};
        this.client = new PahoMqtt.Client(broker_url, broker_port, client_id);
        let hostlist;
        if (useSSL) {
            hostlist = [`wss://${broker_url}:${broker_port}/`];
        } else {
            hostlist = [`ws://${broker_url}:${broker_port}/`];
        }
        this.options = {
            hosts: hostlist,
            useSSL: useSSL
        };

        this.client.onMessageArrived = (message) => {
            const matching_topics = Object.keys(this.callbacks).filter((topic) =>
                is_match(message.destinationName, topic)
            );
            for (const match of matching_topics) {
                for (const callback of this.callbacks[match]) {
                    callback(message);
                }
            }
        };
    }

    onConnectionLost(cb) {
        this.client.onConnectionLost = cb;
    }

    isConnected() {
        return this.client.isConnected();
    }

    async connect(options = {}) {
        debug(options);
        return new Promise((resolve, reject) => {
            this.options["onSuccess"] = (_) => {
                debug("Connected to broker.");
                resolve();
            };
            this.options["onFailure"] = (resp) => {
                debug("Failed to connect: " + resp.errorMessage);
                reject(resp);
            };
            console.log("attempting to connect...");
            this.client.connect(this.options);
        });
    }

    subscribe(topic, cb) {
        if (!(topic in this.callbacks)) {
            this.callbacks[topic] = [];
            this.client.subscribe(topic);
        }
        this.callbacks[topic].push(cb);
    }

    publish(topic, payload, retained = false) {
        let msg = new PahoMqtt.Message(payload);
        msg.destinationName = topic;
        msg.retained = retained;
        this.client.send(msg);
    }

    unsubscribe(topic) {
        delete this.callbacks[topic];
        this.client.unsubscribe(topic);
    }

    async awaitEvent(namespace, assetName, submodelName, eventName, timeout) {
        let timer;
        const basePath = `${namespace}/${assetName}/${submodelName}/${eventName}`;
        const p1 = new Promise((resolve, reject) => {
            function eventCallback(message) {
                const respObj = JSON.parse(message.payloadString);
                resolve(respObj);

            }
            this.subscribe(basePath, eventCallback);

        });
        const p2 = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject("timeout"), timeout);
        });
        return Promise.race([p1, p2]).finally(() => clearTimeout(timer));
    }

    async callOperation(namespace, assetName, submodelName, operationName, params, timeout = 0) {
        const payloadObj = { "req_id": uuidv4(), "params": params };
        const payloadString = JSON.stringify(payloadObj);
        let timer;
        const basePath = `${namespace}/${assetName}/${submodelName}/${operationName}`;
        const p1 = new Promise((resolve, reject) => {
            function responseCallback(message) {
                const respObj = JSON.parse(message.payloadString);
                if (respObj.req_id === payloadObj.req_id) {
                    resolve(respObj.resp);
                }
            }
            this.subscribe(basePath + "/RESP", responseCallback);
            this.publish(basePath + "/REQ", payloadString);
        });
        if (timeout <= 0) {
            return p1;
        }
        const p2 = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject("timeout"), timeout);
        });
        return Promise.race([p1, p2]).finally(() => clearTimeout(timer));

    }
}
