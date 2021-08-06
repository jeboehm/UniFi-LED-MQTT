const MQTT = require('mqtt');
const SSH = require('simple-ssh');
const READ_INTERVAL = 30000;
const WRITE_INTERVAL = 2000;
const COLOR_PATH = '/proc/ubnt_ledbar/custom_color';
const BRIGHTNESS_PATH = '/proc/ubnt_ledbar/brightness';
const LED_PATTERN_PATH = '/proc/gpio/led_pattern';

const readConfig = function () {
    const fs = require('fs');

    return JSON.parse(fs.readFileSync('config.json'));
}

const mqttPublish = function (client, name, type, value) {
    client.publish('unifi/' + name + '/' + type, value);
}

const createSSHFor = function (nameAP, config) {
    return new SSH({
        host: config.ap[nameAP].host,
        user: config.ap[nameAP].username,
        pass: config.ap[nameAP].password
    });
}

const processMessage = function (topic, message, config) {
    const parts = topic.split('/', 3);
    const nameAP = parts[1];
    const command = parts[2];

    const ssh = createSSHFor(nameAP, config);
    let file;

    switch (command) {
        case 'set_color':
            file = COLOR_PATH;
            break;
        case 'set_brightness':
            file = BRIGHTNESS_PATH;
            break;
        case 'set_power':
            file = LED_PATTERN_PATH;
            break;
    }

    console.debug('Processing command: ' + command + ' to AP ' + nameAP + ' in file: ' + file);

    let msg = message.toString();

    ssh
        .exec('cat > ' + file, {
            in: msg
        })
        .start();
}

const readLoop = function (mqttClient, config) {
    for (let nameAP in config.ap) {
        const ssh = createSSHFor(nameAP, config);

        ssh
            .exec('cat ' + COLOR_PATH, {
                out: function (stdout) {
                    console.debug('AP: ' + nameAP + ' Color: ' + stdout);

                    mqttPublish(mqttClient, nameAP, 'color', stdout);
                }
            })
            .exec('cat ' + BRIGHTNESS_PATH, {
                out: function (stdout) {
                    console.debug('AP: ' + nameAP + ' Brightness: ' + stdout);

                    mqttPublish(mqttClient, nameAP, 'brightness', stdout);
                }
            })
            .exec('cat ' + LED_PATTERN_PATH, {
                out: function (stdout) {
                    console.debug('AP: ' + nameAP + ' LED Pattern: ' + stdout);

                    mqttPublish(mqttClient, nameAP, 'power', stdout);
                }
            })
            .start();
    }
}

const subscribe = function (mqttClient, config) {
    for (let nameAP in config.ap) {
        mqttClient.subscribe('unifi/' + nameAP + '/set_color');
        mqttClient.subscribe('unifi/' + nameAP + '/set_brightness');
        mqttClient.subscribe('unifi/' + nameAP + '/set_power');
    }
}

const config = readConfig();
const mqttClient = MQTT.connect(config.mqtt);
const commandQueue = [];

mqttClient.on('connect', function () {
    subscribe(mqttClient, config);
});

mqttClient.on('message', function (topic, message) {
    commandQueue.push({
        topic,
        message
    });
});

setInterval(function () {
    console.debug('Reading states from devices..');
    readLoop(mqttClient, config);
}, READ_INTERVAL);

setInterval(function () {
    if (commandQueue.length > 0) {
        const command = commandQueue.pop();
        commandQueue.length = 0;
        processMessage(command.topic, command.message, config);
    }
}, WRITE_INTERVAL);