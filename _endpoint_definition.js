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

export default Object.freeze({
    "name": "_endpoint",
    "revision": "0.0.3",
    "description": "Meldet Online- und Healthy-Status eines Assets",
    "properties": {
        "online": {
            "description": "Asset ist online, der Adapter ist erreichbar",
            "type": "boolean"
        },
        "healthy": {
            "description": "Asset ist healthy, der Adapter ist bereit",
            "type": "boolean"
        }
    },
    "events": {
        "log": {
            "description": "Logging Event",
            "parameters": {
                "entry": {
                    "description": "Logging Text",
                    "type": "string"
                }
            }
        }
    },
    "operations": {
        "shutdown": {
            "description": "Asset ausschalten",
            "parameters": {}
        },
        "restart": {
            "description": "Asset neu starten",
            "parameters": {}
        },
        "ping": {
            "description": "Ping Asset",
            "parameters": {}
        }
    }
});