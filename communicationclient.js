import mqtt from "mqtt";
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
    constructor() {
        this.callbacks = {};
        this.client = undefined;
    }

    is_connected() {
        return this.client!=undefined && this.client.connected;
    }

    on_message(topic, message) {
        if (this.callbacks == {}) return;
        const message_str = message.toString();
        const matching_topics = Object.keys(this.callbacks).filter((registered_topic) =>
            is_match(topic,registered_topic)
        );
        for (const match of matching_topics) {
            for (const callback of this.callbacks[match]) {
                callback(message_str);
            }
        }
    }

    async callOperation(namespace, assetName, submodelName, operationName, parameters, timeout){
        const req_id = uuidv4();
        const topic = `${namespace}/${assetName}/${submodelName}/${operationName}/REQ`;
        const response_topic = `${namespace}/${assetName}/${submodelName}/${operationName}/RESP`;
        const promise = this.awaitResponse(response_topic, req_id,timeout);
        const payload = JSON.stringify({req_id:req_id,params:parameters});
        await this.publish(topic, payload);
        return await promise;
    }

    async bindOperation(namespace, assetName, submodelName, operationName, callback){
        const topic = `${namespace}/${assetName}/${submodelName}/${operationName}/REQ`;
        const operation_callback = async (message)=>{
            const request = JSON.parse(message);
            const response = callback(request.params);
            const response_payload = JSON.stringify({req_id: request.req_id, resp: response});
            const response_topic = `${namespace}/${assetName}/${submodelName}/${operationName}/RESP`;
            await this.publish(response_topic,response_payload);
        }
        await this.subscribe(topic,operation_callback);
    }

    async awaitSingleMessage(topic,timeout){
        let timer;
        return new Promise((resolve,reject)=>{
            
            const callback = (message)=>{
                clearTimeout(timer);
                resolve(message);
            }
            this.subscribe(topic,callback);
            timer = setTimeout(()=>{
                this.unsubscribe(topic,callback);
                reject("timeout");
            },timeout)
        })
    }

    async subscribeEvent(namespace, assetName, submodelName, eventName, cb){
        const topic = `${namespace}/${assetName}/${submodelName}/${eventName}`;
        await this.subscribe(topic,cb);
    }

    async awaitEvent(namespace, assetName, submodelName, eventName, timeout){
       return this.awaitSingleMessage(`${namespace}/${assetName}/${submodelName}/${eventName}`,timeout);
    }

    async awaitResponse(topic, req_id, timeout){
        let timer;
        return new Promise((resolve,reject)=>{
            const callback = (message)=>{
                clearTimeout(timer);
                const response = JSON.parse(message);
                if (response.req_id===req_id){
                    resolve(response.resp);
                }
            }
            this.subscribe(topic,callback);
            timer = setTimeout(()=>{
                this.unsubscribe(topic,callback);
                reject("timeout");
            },timeout)
        })
    }
    
    async connect(broker_url, port, ssl, options = {}) {
        const protocol = ssl ? "wss" : "ws";
        this.client = await mqtt.connectAsync(`${protocol}://${broker_url}:${port}`, options);
        debug("Connected to broker.");
        this.client.on("message", (topic,message)=>this.on_message(topic,message));
      
    }

    async disconnect(){
        if (this.client==undefined) return;
        return await this.client.endAsync();
    }

    async subscribe(topic, cb) {
        if (!this.callbacks[topic]) {
            this.callbacks[topic] = [];
        }
        this.callbacks[topic].push(cb);
        await this.client.subscribeAsync(topic);
    }

    async unsubscribe(topic, cb) {
        if (this.callbacks[topic]) {
            this.callbacks[topic] = this.callbacks[topic].filter((callback) => callback !== cb);
            if (this.callbacks[topic].length == 0) {
                delete this.callbacks[topic];
                await this.client.unsubscribeAsync(topic);
            }
        }        
    }

    async publish(topic, message) {
        return await this.client.publishAsync(topic, message);
    }

}
