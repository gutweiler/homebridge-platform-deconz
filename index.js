var request = require('request');

var Accessory, Characteristic, Consumption, Service, TotalConsumption, UUIDGen;

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

    this.api.on('didFinishLaunching', function() {
        this.importLights()
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

deconzPlatform.prototype.importLights = function(accessory) {
    request.get(this.apiURL('lights'), function (error, response, body) {
        if (!error && response.statusCode == 200) {
            this.apiLights = JSON.parse(body)
            for( var k in this.apiLights) {
                this.apiLights[k].id = k
                this.addDiscoveredLight(this.apiLights[k])
            }
            console.log('Fertig')
        }
    }.bind(this));
}

deconzPlatform.prototype.addDiscoveredLight = function(light) {
    console.log("addDiscoveredLight")

    var uuid = UUIDGen.generate(light.uniqueid);

    accessory = this.accessories[uuid]

    // console.log(light)

    if (accessory !== undefined) {
        this.api.unregisterPlatformAccessories("homebridge-platform-deconz", "deconz", [accessory]);
    }

    // if (accessory === undefined) {
        var accessory = new Accessory(light.name, uuid);
        var service = accessory.addService(Service.Lightbulb, light.name);

        // On/Off plug-in unit
        service
            .getCharacteristic(Characteristic.On)
            .on('get', function(callback) { this.getPowerOn(light, callback) }.bind(this))
            .on('set', function(val, callback) { this.setPowerOn(val, light, callback) }.bind(this))

        if(light.type == "Dimmable light" || light.type == "Extended color light") {
            service
                .addCharacteristic(new Characteristic.Brightness())
                .on('get', function(callback) { this.getBrightness(light, callback) }.bind(this))
                .on('set', function(val, callback) { this.setBrightness(val, light, callback) }.bind(this))
        }
        // if Extended color light

        accessory.updateReachability(true)

        this.accessories[accessory.UUID] = accessory;
        this.api.registerPlatformAccessories("homebridge-platform-deconz", "deconz", [accessory]);
    /*} else {
        console.log("schon bekannt..")
    }*/
}

deconzPlatform.prototype.getPowerOn = function(light, callback) {
    console.log("getPowerOn", light.name)

    this.getLight(light, function(light) {
        console.log(light.name, light.state.on)
        callback(null, light.state.on)
    })
}

deconzPlatform.prototype.setPowerOn = function(val, light, callback) {
    console.log("setPowerOn", light.name, val)
    
    this.putLightState(light, { "on": val == 1 }, function(response) {
        console.log("light on response", response)
        callback(null)
    })
}

deconzPlatform.prototype.getBrightness = function(light, callback) {
    console.log("getBrightness", light.name)
    
    this.getLight(light, function(light) {
        callback(null, light.state.bri / 255 * 100)
    })
}

deconzPlatform.prototype.setBrightness = function(val, light, callback) {
    console.log("setBrightness", light.name, val)
    
    this.putLightState(light, { "bri": val / 100 * 255 }, function(response) {
        // console.log("light bri response", response)
        callback(null)
    })
}

deconzPlatform.prototype.configureAccessory = function(accessory) {
    accessory.updateReachability(true);
    this.accessories[accessory.UUID] = accessory;
}
