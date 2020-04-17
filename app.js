var isdebug = typeof v8debug === 'object' || /--debug|--inspect/.test(process.execArgv.join(' '));
process.env["NODE_ENV"] = isdebug ? "debug" : "production"; // Variabile per la scelta del file config

const fs = require('fs');
const config = require('config');
const _ = require('lodash');
const moment = require('moment');
const request = require('request');
const TelegramBot = require('node-telegram-bot-api');
var app = require('express')();
var http = require('http').createServer(app);
var ottd = require("node-openttd-admin"),
    ottdConnection = new ottd.connection();

let credentials = JSON.parse(fs.readFileSync('credentials.json'));

// LowDb
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db.json')
const db = low(adapter)
db.defaults({
        chats: []
    })
    .write()

var ottd_server = {};
var ottd_clients = {};
var ottd_companies = {};

var logs_cache_max = config.get("logs_cache_max");
var logs_cache = [];

debugLog("App Service avviato");
debugLog("Debug status: " + isdebug);
debugLog("Config: " + process.env["NODE_ENV"]);

const send_message_options = { // Options bot telegram
    parse_mode: "markdown"
}

// SERVER WEB
app.get('/', function (req, res) {
    res.sendFile('node.html', {
        root: __dirname
    }); // la sotto directory del sito matt
    console.log('Request hostname:', req.hostname);
    console.log('Request URL:', req.originalUrl);
});

// LOG page
app.get('/log', function (req, res) {   
    res.sendFile('log.html', {
        root: __dirname
    });
});

//Si mette in ascolto sulla porta specificata (per app service azure)
http.listen(process.env.PORT || 3000, function () {
    debugLog("Web server in ascolto su porta " + (process.env.PORT || 3000) + " ...");
});


// TELEGRAM
// Create a bot that uses 'polling' to fetch new updates
var bot_options = {
    polling: config.get("bot_polling")
};
const bot = new TelegramBot(credentials["telegram"], bot_options);

debugLog("Telegram bot inizializzato (" + JSON.stringify(bot_options) + ")");

var chats = {};

// Gestione dei comandi e messaggi in entrata
bot.on('message', (msg) => {

    console.log(msg);

    debugLog("[" + msg.chat.id + "] > " + msg.text);

    if (!msg.text) return;

    msg.text = msg.text.replace("@ottd_serverbot", "");

    // Gestione comandi
    switch (msg.text) {
        case "/start":
            var chat = db.get('chats') // verifica se è già stato salvato l'id della chat
                .find({
                    id: msg.chat.id
                })
                .value();

            if (!chat) {
                db.get('chats').push(msg.chat).write()
            }

            break;
        case "/chats":
            var chats = db.get('chats').value();
            _.each(chats, function (chat) {
                switch (chat.type) {
                    case "private":
                        bot.sendMessage(chat.id, "Hello " + chat.first_name + " " + chat.last_name + "!");
                        break;
                }
            });
            break;
        case "/login":

                break;
        case "/logout":

            break;
        case "/info":

            break;
        case "/restart":
            ottdConnection.send_rcon("restart");
            break;
            case "/companies":
                ottdConnection.send_rcon("companies");
                break;
                case "/clients":
                    ottdConnection.send_rcon("clients");
                    break;
            break;
        default:
            console.log(msg.text);
            break;

    }

});

function sendMessage(text) {
    console.log("BOT > " + JSON.stringify(text));
    var chats = db.get('chats').value();
    _.each(chats, function (chat) {
        //bot.sendMessage(chat.id, text);
    });
}

function debugLog(msg) {
    msg = moment().format('DD/MM/YYYY HH:mm:ss') + " - " + msg; // aggiunge data a log
    // Gestione cache
    logs_cache.push(msg);
    if (logs_cache.length > logs_cache_max)
        logs_cache.shift(); // rimuove il primo elemento

    console.log(msg);
    //io.emit('log', msg); // broadcast a tutti i socket collegati
}


// OpenTTD
ottdConnection.connect(credentials["ottd"]["host"], credentials["ottd"]["admin_port"]);

ottdConnection.on('connect', function () {
    ottdConnection.authenticate(credentials["ottd"]["admin_user"], credentials["ottd"]["admin_psw"]);
});

ottdConnection.on('welcome', function (data) {
    console.log(data);

    ottd_server = data;
    sendMessage("BOT connesso a " + ottd_server.name);

    // inizializza tipo di aggiornamenti
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.CLIENT_INFO, ottd.enums.UpdateFrequencies.AUTOMATIC);
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.CHAT, ottd.enums.UpdateFrequencies.AUTOMATIC);
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.COMPANY_INFO, ottd.enums.UpdateFrequencies.AUTOMATIC);
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.COMPANY_ECONOMY, ottd.enums.UpdateFrequencies.MONTHLY);
    
    //ottdConnection.send_rcon("clients");
    //ottdConnection.send_rcon("companies");

});

ottdConnection.on('rcon', function (data) {
    console.log("rcon", data);
    sendMessage(data);
});

ottdConnection.on('date', function (data) {
    console.log(data);
});

ottdConnection.on('chat', function (data) {
    console.log("chat", data);
    var name = data.id;
    if (ottd_clients[data.id]) {
        name = ottd_clients[data.id].name;
    }
});

ottdConnection.on('newgame', function (data) {
    sendMessage(ottd_server.name + " NEW GAME");
});

ottdConnection.on('shutdown', function (data) {
    sendMessage(ottd_server.name + " SHUTDOWN!");
});

ottdConnection.on('clientjoin', function (data) {
    console.log("clientjoin", data);
    if (ottd_clients[data]) {
        sendMessage(ottd_clients[data].name + " è entrato nella partita");
    }
});

ottdConnection.on('clientquit', function (data) {
    console.log(data);
    if (ottd_clients[data]) {
        sendMessage(ottd_clients[data].name + " ha abbandonato la partita");
        delete ottd_clients[data];
    }
});

ottdConnection.on('clienterror', function (client) {
    console.log("Client with id: ", client.id, " has had an error: ", client.err);
    if (ottd_clients[client.id]) {
        sendMessage(ottd_clients[client.id].name + " > ERRORE: " + client.err);
    }
});

ottdConnection.on('clientinfo', function (data) {
    console.log("clientinfo", data);
    ottd_clients[data.id] = data;
});

ottdConnection.on('clientupdate', function (data) {
    console.log("clientupdate", data);
});

// COMPANY
ottdConnection.on('companyinfo', function (data) {
    console.log("companyinfo", data);
    ottd_companies[data.id] = data;
});

ottdConnection.on('companyupdate', function (data) {
    console.log("companyupdate", data);
});

ottdConnection.on('companyeconomy', function (data) {
    console.log("companyeconomy", data);

});

ottdConnection.on('companyremove', function (data) {
    console.log("companyremove", data);
});

ottdConnection.on('companystats', function (data) {
    console.log("companystats", data);
});