import {expect, test, vi, assert} from "vitest"
import CommunicationClient from "./communicationclient.js"

const broker = "test.mosquitto.org";
const port = 8080;

async function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


test("create_communication_client", () => {
    const client = new CommunicationClient();
    expect(client).toBeDefined();
    client.disconnect();
})

test("connection_plain", async () => {
    const client = new CommunicationClient();
    expect(client.isConnected()).toBe(false);
    
    const port = 8080;
    await client.connect(broker, port, false);
    expect(client.isConnected()).toBe(true);
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
})

test("connection_ssl", async () => {
    const client = new CommunicationClient();
    expect(client.isConnected()).toBe(false);
    const port = 8081;
    await client.connect(broker, port, true);
    expect(client.isConnected()).toBe(true);
})


test("subscribe", async () => {
    const client = new CommunicationClient();
    const topic = "arena2036_test";
    const messages = {
        callback: (message) => {
            expect(message).toBe("test_message");
        }
    }
    const spy = vi.spyOn(messages,"callback")
    await client.connect("test.mosquitto.org", 8080, false);
    await client.subscribe(topic, messages.callback);
    await client.publish(topic, "test_message");
    await vi.waitUntil(()=>spy.mock.calls.length>0,{timeout:1000,interval:200})
    expect(spy).toHaveBeenCalledTimes(1);
})

test("unsubscribe", async () => {
    const client = new CommunicationClient();
    const topic = "arena2036_test_2";
    const messages = {callback : (message) => {
        expect(message).toBe("test_message");
    }}
    const spy = vi.spyOn(messages,"callback")
    await client.connect(broker,port, false);
    await client.subscribe(topic, messages.callback);
    await client.publish(topic, "test_message");
    await vi.waitUntil(()=>spy.mock.calls.length>0,{timeout:1000,interval:200})
    expect(spy).toHaveBeenCalledTimes(1);
    await client.unsubscribe(topic, messages.callback);
    await client.publish(topic, "test_message");
    await wait(1000);
    expect(spy).toHaveBeenCalledTimes(1);
})

test("callback_multiple", async () => {
    const client = new CommunicationClient();
    const topic1 = "arena2036_test_3";
    const topic2 = "arena2036_test_4";
    const messages = {
        callback1: (message) => {
            expect(message).toBe("test_message");
        },
        callback2: (message) => {
            expect(message).toBe("test_message");
        }
    }
    const spy1 = vi.spyOn(messages,"callback1")
    const spy2 = vi.spyOn(messages,"callback2")
    await client.connect("test.mosquitto.org", 8080, false);
    await client.subscribe(topic1, messages.callback1);
    await client.subscribe(topic2, messages.callback2);
    await client.publish(topic1, "test_message");
    await client.publish(topic1, "test_message");
    await client.publish(topic2, "test_message");
    await client.publish(topic2, "test_message");
    await vi.waitUntil(()=>spy1.mock.calls.length>0,{timeout:1000,interval:200})
    await vi.waitUntil(()=>spy2.mock.calls.length>0,{timeout:1000,interval:200})
    expect(spy1).toHaveBeenCalledTimes(2);
    expect(spy2).toHaveBeenCalledTimes(2);
});

test("callback_wildcard_topics", async () => {
    const client = new CommunicationClient();
    const topic1 = "supertest_arena2036/test/3";
    const topic2 = "supertest_arena2036/test/4";
    const wildcard_topic1 = "supertest_arena2036/#";
    const wildcard_topic2 = "supertest_arena2036/test/#";
    const messages = {
        callback_1: (message) => {
            const prefix = message.substring(0, 12);
            expect(prefix).toBe("test_message");
        },
        callback_2: (message) => {
            const prefix = message.substring(0, 12);
            expect(prefix).toBe("test_message");
        }
    }

    const spy1 = vi.spyOn(messages,"callback_1")
    const spy2 = vi.spyOn(messages,"callback_2")
    await client.connect("test.mosquitto.org", 8080, false);
    await client.subscribe(wildcard_topic1, messages.callback_1);
    await client.subscribe(wildcard_topic2, messages.callback_2);
    await client.publish(topic1, "test_message_1");
    await client.publish(topic2, "test_message_2");
    await vi.waitUntil(()=>spy1.mock.calls.length>1,{timeout:1000,interval:200})
    expect(spy1).toHaveBeenCalledTimes(4);
    await vi.waitUntil(()=>spy2.mock.calls.length>1,{timeout:1000,interval:200})
    expect(spy2).toHaveBeenCalledTimes(4);
}
)

test("receive event once", async () => {
    const client = new CommunicationClient();
    const topic = "arena2036/myasset/mysubmodel/my_test_event";
    let event_received = false;
    await client.connect(broker, port, false);
    client.awaitEvent("arena2036", "myasset", "mysubmodel", "my_test_event", 1000).then((message)=>{
        expect(message).toBe("test_message");
        event_received = true;
    })
    
    await client.publish(topic, "test_message");
    await vi.waitUntil(()=>event_received,{timeout:1000,interval:200})
    
})
test("await response timeout", async () => {
    const client = new CommunicationClient();
    const topic = "arena2036/myasset/mysubmodel/my_test_operation/RESP";
    let response_received = false;
    await client.connect(broker, port, false);
    await client.awaitResponse(topic, "req_id" ,500).catch((timeout)=>{
        expect(timeout).toBe("timeout");
        response_received = true;
    })
    await vi.waitUntil(()=>response_received,{timeout:3000,interval:200})
    

})
test("bind and call operation", async () => {
    const client = new CommunicationClient();
    await client.connect(broker, port, false);
    await client.bindOperation("arena2036", "myasset", "mysubmodel", "my_test_operation", (params) => {
        expect(params.param1).toBe("test_param");
        return 42;
    });
    try {
        const response = await client.callOperation("arena2036", "myasset", "mysubmodel", "my_test_operation", {param1: "test_param"},3000);
        expect(response).toBe(42);
    } catch (error) {
       assert(false);
    }
});