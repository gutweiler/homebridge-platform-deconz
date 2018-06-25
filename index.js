var request = require('request');
var W3CWebSocket = require('websocket').w3cwebsocket;

var Accessory, Characteristic, UUIDGen;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;
    homebridge.registerPlatform("homebridge-platform-deconz", "deconz", deconzPlatform, true);
};

function deconzPlatform(log, config, api) {

    this.log = log;
    this.api = api;
    this.config = config;

    this.accessories = {};

    this.apiHost = config['host'];
    this.apiPort = config['port'];
    this.apiKey = config['apikey'];
    this.apiURLPrefix = `http://${this.apiHost}:${this.apiPort}/api/${this.apiKey}/`
    this.apiConfig = false

    this.api.on('didFinishLaunching', function() {
        this.importLights()
        this.importSensors()
        this.importConfig().then((config) => {
            this.initWebsocket()
        })
    }.bind(this));

}

deconzPlatform.prototype.apiURL = function(path) {
    return this.apiURLPrefix + path
}


deconzPlatform.prototype.getLight = function(light, callback) {
    request.get(this.apiURL("lights/"+light.id), function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var light = JSON.parse(body)
            callback(light)
        }
    })
}

deconzPlatform.prototype.putLightState = function(light, body, callback) {
    request.put({url: this.apiURL("lights/"+light.id+"/state"), json: true, body: body}, function (error, response, body) {
        // console.log("response", response)
        callback(true)
        /*
        if (!error && response.statusCode == 200) {
            var light = JSON.parse(body)
            callback(light)
        }
        */
    })
}

deconzPlatform.prototype.getSensor = function(sensor, callback) {
    return new Promise((resolve, reject) => {
        request.get(this.apiURL("sensors/"+sensor.id), function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var sensor = JSON.parse(body)
                resolve(sensor)
            } else reject(error)
        })
    });
}

deconzPlatform.prototype.importConfig = function() {
    return new Promise((resolve, reject) => {
        request.get(this.apiURL('config'), (error, response, body) => {
            if (!error && response.statusCode == 200) {
                this.apiConfig = JSON.parse(body)
                resolve(this.apiConfig)
            } else {
                reject()
            }
        })
    });
}

deconzPlatform.prototype.initWebsocket = function() {
    var url = 'ws://' + this.apiHost + ':' + this.apiConfig.websocketport + '/';
    console.log('websocket connecting', url)

    var client = new W3CWebSocket(url);
 
    client.onerror = function() {
        console.log('websocket connection error', url);
    };
    
    client.onclose = function() {
        console.log('websocket connection closed', url );
    };
    
    client.onmessage = (e) => {
        if (typeof e.data === 'string') {
            var d = JSON.parse(e.data);
			if(!this.apiSensors[d.id] || !this.apiSensors[d.id].accessory) return

			var light = this.apiSensors[d.id]
			
			if(light.type == "ZHAPresence") {
				light.accessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, d.state.presence == true)
			}

			if(light.type == "ZHALightLevel") {
				light.accessory.getService(Service.LightSensor).setCharacteristic(Characteristic.CurrentAmbientLightLevel, d.state.lux)
			}

			if(light.type == "ZHATemperature") {
				light.accessory.getService(Service.TemperatureSensor).setCharacteristic(Characteristic.CurrentTemperature, d.state.temperature/100)
			}
        }
    };
}

deconzPlatform.prototype.importLights = function() {
    request.get(this.apiURL('lights'), (error, response, body) => {
        if (!error && response.statusCode == 200) {
            this.apiLights = JSON.parse(body)
            for( var k in this.apiLights) {
                this.apiLights[k].id = k
                this.addDiscoveredAccessory(this.apiLights[k])
            }
            // console.log('importLights finished')
        }
    })
}

deconzPlatform.prototype.importSensors = function() {
    request.get(this.apiURL('sensors'), (error, response, body) => {
        if (!error && response.statusCode == 200) {
            this.apiSensors = JSON.parse(body)
            for( var k in this.apiSensors) {
                this.apiSensors[k].id = k
                this.apiSensors[k].accessory = this.addDiscoveredAccessory(this.apiSensors[k])
            }
            console.log('importSensors finished', this.apiSensors)
        }
    })
}


deconzPlatform.prototype.addDiscoveredAccessory = function(light) {
    // console.log("addDiscoveredLight", light.type, light)

    if( !light.uniqueid ) {
        console.warn('accessory.uniqueid missing', light)
        return
    }
    var uuid = UUIDGen.generate(light.uniqueid);

    accessory = this.accessories[uuid]

    // console.log(light)

    if (accessory !== undefined) {
        this.api.unregisterPlatformAccessories("homebridge-platform-deconz", "deconz", [accessory]);
    }

    // if (accessory === undefined) {
        var accessory = new Accessory(light.name, uuid);

        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js
        var serviceType = Service.Lightbulb
        switch(light.type) {
            case "On/Off plug-in unit":
                serviceType = Service.Switch
            break;

            // Hue motion sensor types
            case "ZHAPresence":
                serviceType = Service.MotionSensor
            break;
            case "ZHALightLevel":
                serviceType = Service.LightSensor
            break;
            case "ZHATemperature":
                serviceType = Service.TemperatureSensor
            break;
            case "Daylight":
                serviceType = Service.LightSensor
            break;
        }
        // console.log('service', serviceType, light.name)
        var service = accessory.addService(serviceType, light.name);

        var infoService = accessory.getService(Service.AccessoryInformation)
        infoService.setCharacteristic(Characteristic.Manufacturer, light.manufacturername)
        infoService.setCharacteristic(Characteristic.Model, light.modelid)
        infoService.setCharacteristic(Characteristic.SerialNumber, light.uniqueid)

        // On/Off plug-in unit
        if( serviceType == Service.Lightbulb || serviceType == Service.Switch) {
            service
                .getCharacteristic(Characteristic.On)
                .on('get', function(callback) { this.getPowerOn(light, callback) }.bind(this))
                .on('set', function(val, callback) { this.setPowerOn(val, light, callback) }.bind(this))
        }

        if(light.type == "Color temperature light" || light.type == "Dimmable light" || light.type == "Extended color light") {
            service
                .addCharacteristic(new Characteristic.Brightness())
                .on('get', function(callback) { this.getBrightness(light, callback) }.bind(this))
                .on('set', function(val, callback) { this.setBrightness(val, light, callback) }.bind(this))
        }

        if(light.type == "Color temperature light") {
            service
                .addCharacteristic(new Characteristic.ColorTemperature())
                .on('get', function(callback) { this.getColorTemperature(light, callback) }.bind(this))
                .on('set', function(val, callback) { this.setColorTemperature(val, light, callback) }.bind(this))
        }

        if(light.type == "Extended color light") {
            // Characteristic.Saturation
            // Characteristic.Hue

            // Color Temperature
            // 3.4 Hue and Saturation
            // In HomeKit, colour is actually defined by two characteristics, Hue and Saturation. Most HomeKit apps provide a colour picker of some sort, hiding these characteristics. In the Hue bridge, colour is defined by the IEC 1931 colour space xy coordinates. homebridge-hue translates Hue and Saturation into xy and back.
            service
                .addCharacteristic(new Characteristic.Hue)
                .on('get', function(callback) { this.getHue(light, callback) }.bind(this))
                .on('set', function(val, callback) { this.setHue(val, light, callback) }.bind(this))

            service
                .addCharacteristic(new Characteristic.Saturation)
                .on('get', function(callback) { this.getSaturation(light, callback) }.bind(this))
                .on('set', function(val, callback) { this.setSaturation(val, light, callback) }.bind(this))
        }

        if(light.type == "ZHAPresence") {
            service
                .getCharacteristic(Characteristic.MotionDetected)
                .on('get', (callback) => { this.getSensorPresence(light, callback) })
        }

        if(light.type == "ZHALightLevel") {
            service
                .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                .on('get', (callback) => { this.getSensorLightLevel(light, callback) })
        }

        if(light.type == "ZHATemperature") {
            service
                .getCharacteristic(Characteristic.CurrentTemperature)
                .on('get', (callback) => { this.getSensorTemperature(light, callback) })
        }

        accessory.updateReachability(true)

        this.accessories[accessory.UUID] = accessory;
        this.api.registerPlatformAccessories("homebridge-platform-deconz", "deconz", [accessory]);
    /*} else {
        console.log("schon bekannt..")
    }*/

    return accessory
}

deconzPlatform.prototype.getPowerOn = function(light, callback) {
    // console.log("getPowerOn", light.name)

    this.getLight(light, function(light) {
        console.log(light.name, light.state.on)
        callback(null, light.state.on)
    })
}

deconzPlatform.prototype.setPowerOn = function(val, light, callback) {
    // console.log("setPowerOn", light.name, val)
    
    this.putLightState(light, { "on": val == 1 }, function(response) {
        console.log("light on response", response)
        callback(null)
    })
}

deconzPlatform.prototype.getHue = function(light, callback) {
    // console.log("getHue", light.name)
    
    this.getLight(light, function(light) {
        var hue = light.state.hue / 65535 * 360
        // console.log("hue", hue)
        callback(null, hue)
    })
}

deconzPlatform.prototype.setHue = function(val, light, callback) {
    // console.log("setHue", light.name, val)
    var hue = val / 360 * 65535
    // console.log("hue", hue)
    this.putLightState(light, { "hue": hue }, function(response) {
        // console.log("light bri response", response)
        callback(null)
    })
}

deconzPlatform.prototype.getSaturation = function(light, callback) {
    // console.log("getSaturation", light.name)
    
    this.getLight(light, function(light) {
        callback(null, light.state.sat / 255 * 100)
    })
}

deconzPlatform.prototype.setSaturation = function(val, light, callback) {
    // console.log("setSaturation", light.name, val)
    
    this.putLightState(light, { "sat": val / 100 * 255 }, function(response) {
        // console.log("light bri response", response)
        callback(null)
    })
}

deconzPlatform.prototype.getBrightness = function(light, callback) {
    // console.log("getBrightness", light.name)
    
    this.getLight(light, function(light) {
        callback(null, light.state.bri / 255 * 100)
    })
}

deconzPlatform.prototype.setBrightness = function(val, light, callback) {
    // console.log("setBrightness", light.name, val)
    
    this.putLightState(light, { "bri": val / 100 * 255 }, function(response) {
        // console.log("light bri response", response)
        callback(null)
    })
}

deconzPlatform.prototype.getColorTemperature = function(light, callback) {
    // console.log("getColorTemperature", light.name)
    
    this.getLight(light, function(light) {
        callback(null, light.state.ct)
    })
}

deconzPlatform.prototype.setColorTemperature = function(val, light, callback) {
    // console.log("setColorTemperature", light.name, val)
    
    this.putLightState(light, { "ct": val }, function(response) {
        // console.log("light ct response", response)
        callback(null)
    })
}

deconzPlatform.prototype.getSensorPresence = function(sensor, callback) {
    this.getSensor(sensor).then((s) => {
        callback(null, s.state.presence == true)
    })
}

deconzPlatform.prototype.getSensorTemperature = function(sensor, callback) {
    this.getSensor(sensor).then((s) => {
        callback(null, s.state.temperature/100)
    })
}

deconzPlatform.prototype.getSensorLightLevel = function(sensor, callback) {
    this.getSensor(sensor).then((s) => {
        callback(null, s.state.lux)
    })
}

deconzPlatform.prototype.configureAccessory = function(accessory) {
    accessory.updateReachability(true);
    this.accessories[accessory.UUID] = accessory;
}
