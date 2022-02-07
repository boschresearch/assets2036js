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
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        "name": {
            "$ref": "#/definitions/name"
        },
        "revision": {
            "type": "string",
            "pattern": "^\\d*\\.\\d*\\.\\d*$"
        },
        "description": {
            "type": "string"
        },
        "properties": {
            "$ref": "#/definitions/typeObject"
        },
        "events": {
            "type": "object",
            "additionalProperties": {
                "$ref": "#/definitions/eventDescription"
            }
        },
        "operations": {
            "type": "object",
            "propertyNames": {
                "pattern": "^[A-Za-z_][A-Za-z0-9_.]*$"
            },
            "additionalProperties": {
                "$ref": "#/definitions/operationDescription"
            }
        }
    },
    "required": [
        "name",
        "revision"
    ],
    "definitions": {
        "name": {
            "type": "string",
            "pattern": "^[A-Za-z_][A-Za-z0-9_]*$",
            "minLength": 3
        },
        "simpleTypes": {
            "enum": [
                "array",
                "boolean",
                "integer",
                "null",
                "number",
                "object",
                "string"
            ]
        },
        "eventDescription": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string"
                },
                "parameters": {
                    "$ref": "#/definitions/typeObject"
                }
            }
        },
        "operationDescription": {
            "allOf": [
                {
                    "$ref": "#/definitions/eventDescription"
                },
                {
                    "properties": {
                        "response": {
                            "$ref": "#/definitions/typeDescription"
                        }
                    }
                }
            ]
        },
        "typeDescription": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string"
                },
                "type": {
                    "$ref": "#/definitions/simpleTypes"
                }
            },
            "required": [
                "type"
            ]
        },
        "typeObject": {
            "type": "object",
            "propertyNames": {
                "pattern": "^[A-Za-z_][A-Za-z0-9_.]*$"
            },
            "additionalProperties": {
                "$ref": "#/definitions/typeDescription"
            }
        }
    }
});