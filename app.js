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
var io = require('socket.io')(http);
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
var ottd_date;

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
    res.sendFile('manager.html', {
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

// SOCKET IO
io.on('connection', (socket) => {
    console.log('a user connected');
    socket.on('companies', (data, callback) => {
        console.log('user request companies');
        socket.emit("companies", ottd_companies);
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

// Gestione dei comandi e messaggi in entrata
bot.on('message', (msg) => {

    console.log(msg);

    debugLog("[" + msg.chat.id + "] > " + msg.text);

    if (!msg.text) return;

    msg.text = msg.text.replace("@ottd_serverbot", "");

    if (msg.reply_to_message) {

        if (msg.reply_to_message.text.toLowerCase() === "admin password") {
            loginAdmin(msg.chat, msg.text);
        }

    } else {

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
            case "/admin":

                // Verifica se è admin
                var chat = getChat(msg.chat.id);

                if (chat.type != "private") {
                    bot.sendMessage(msg.chat.id, "🚫 Admin commands not allowed for groups");

                } else if (!chat.admin) {

                    bot.sendMessage(msg.chat.id, "🚫 You aren't Admin", {
                        reply_markup: {
                            inline_keyboard: [
                                [{
                                    text: 'Admin Login',
                                    callback_data: 'login'
                                }]
                            ]
                        }
                    });

                } else {
                    bot.sendMessage(msg.chat.id, "🔑 Admin commands", {
                        reply_markup: {
                            inline_keyboard: [
                                [{
                                    text: 'Restart game',
                                    callback_data: 'restart'
                                }]
                            ]
                        }
                    });
                }

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
    }

});

bot.on('callback_query', function onCallbackQuery(callbackQuery) {
    console.log(callbackQuery);

    const action = callbackQuery.data;
    const msg = callbackQuery.message;
    const opts = {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
    };
    let text;

    switch (action) {
        case "restart":
            ottdConnection.send_rcon("restart");
            bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Game restarted!'
            });
            break;
        case "login":
            bot.sendMessage(msg.chat.id, "Admin password", {
                reply_markup: {
                    force_reply: true
                }
            });

            break;
    }
    //sendChatMessage(text, msg.chat);

});

function loginAdmin(chat, password) {
    if (password === credentials["ottd"]["admin_psw"]) {
        db.get('chats')
            .find({
                id: chat.id
            })
            .assign({
                admin: true
            })
            .write();
        sendChatMessage("🔑 Now you're Admin", chat);
    } else {
        sendChatMessage("❌ Password wrong", chat);
    }

}

function isAdmin(id) {
    return db.get('chats') // verifica se è già stato salvato l'id della chat
        .find({
            id: id
        })
        .value().admin;
}

function getChat(id) {
    return db.get('chats') // verifica se è già stato salvato l'id della chat
        .find({
            id: id
        })
        .value();
}

function sendGlobalMessage(text) {
    console.log("BOT > " + JSON.stringify(text));
    var chats = db.get('chats').value();
    _.each(chats, function (chat) {
        bot.sendMessage(chat.id, text, send_message_options);
    });
}

function sendChatMessage(text, chat) {
    console.log("BOT > " + JSON.stringify(text));
    bot.sendMessage(chat.id, text, send_message_options);
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
    sendGlobalMessage("🚂 BOT connected to *" + ottd_server.name + "* v:" + ottd_server.version + "");

    // inizializza tipo di aggiornamenti
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.CLIENT_INFO, ottd.enums.UpdateFrequencies.AUTOMATIC);
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.CHAT, ottd.enums.UpdateFrequencies.AUTOMATIC);
    //ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.COMPANY_INFO, ottd.enums.UpdateFrequencies.AUTOMATIC);
    //ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.COMPANY_ECONOMY, ottd.enums.UpdateFrequencies.MONTHLY);
    ottdConnection.send_update_frequency(ottd.enums.UpdateTypes.DATE, ottd.enums.UpdateFrequencies.DAILY);

    ottdConnection.send_rcon("clients");
    ottdConnection.send_rcon("companies");

});

ottdConnection.on('rcon', function (data) {
    console.log("rcon", data);

    // verifica se il messaggio contine info compagnia
    if (data.output && data.output.indexOf("Company Name") >= 0) {
        var company = {
            id: parseInt(data.output.substring(data.output.indexOf(":"), data.output.indexOf("(")).split(":")[1].trim()),
            name: data.output.substring(data.output.indexOf("Company Name:"), data.output.indexOf("Year Founded:")).split(":")[1].trim().replace(/'/g, ""),            
            economy: {
                money: parseInt(data.output.substring(data.output.indexOf("Money:"), data.output.indexOf("Loan:")).split(":")[1].trim()) * 2,
                loan: parseInt(data.output.substring(data.output.indexOf("Loan:"), data.output.indexOf("Value:")).split(":")[1].trim()) * 2,
                value: parseInt(data.output.substring(data.output.indexOf("Value:"), data.output.indexOf("(", data.output.indexOf("Value:"))).split(":")[1].trim()) * 2,
            },
            ai: (data.output.indexOf("AI", data.output.indexOf("Value:")) >= 0)
        }
        ottd_companies[company.id] = company;
        console.log("ottd_companies", company);
    } else {
        sendGlobalMessage(data);
    }

});

ottdConnection.on('rconend', function (data) {
    console.log("rconend", data);

    switch (data.command) {
        case "companies": // aggioranmento delle compagnie effettuato
            io.emit("companies", ottd_companies);
            break;
    }

});

ottdConnection.on('date', function (data) {
    ottd_date = new moment(0, 0, 0, 0, 0, 0).add(-1970, "years").add(data, "days");
    io.emit("date", ottd_date);    
    if (ottd_date.get('date') % 5 == 0) {   // aggiorna valore ogni 5 giorni
        ottdConnection.send_rcon("companies");
    }    

});

ottdConnection.on('chat', function (data) {
    console.log("chat", data);
    var name = data.id;
    if (ottd_clients[data.id]) {
        name = ottd_clients[data.id].name;
    }
});


// GAME

ottdConnection.on('newgame', function (data) {

    ottd_companies = {};
    ottd_date = null;
    ottd_server =

        sendGlobalMessage("🛫 *" + ottd_server.name + "* new game started ");
});

ottdConnection.on('shutdown', function (data) {
    sendGlobalMessage("🛬 *" + ottd_server.name + "* game shutdown ");
});


// CLIENTS

ottdConnection.on('clientjoin', function (data) {
    console.log("clientjoin", data);
    if (ottd_clients[data]) {
        sendGlobalMessage("👨‍✈️ *" + ottd_clients[data].name + "* joined game 💪");
    }
});

ottdConnection.on('clientquit', function (data) {
    console.log(data);
    if (ottd_clients[data]) {
        sendGlobalMessage("👨‍✈️ *" + ottd_clients[data].name + "* left game 👋👋");
        delete ottd_clients[data];
    }
});

ottdConnection.on('clienterror', function (client) {
    console.log("Client with id: ", client.id, " has had an error: ", client.err);
    if (ottd_clients[client.id]) {
        switch (client.err) {
            case ottd.enums.NetworkErrorCodes.DESYNC:
                sendGlobalMessage("👨‍✈️ *" + ottd_clients[client.id].name + "* desync");
                break;
            case ottd.enums.NetworkErrorCodes.CONNECTION_LOST:
                sendGlobalMessage("👨‍✈️ *" + ottd_clients[client.id].name + "* connection lost 👋👋");
                break;
            default:
                sendGlobalMessage(ottd_clients[client.id].name + " > ERRORE: " + client.err);
                break;
        }

    }
});

ottdConnection.on('clientinfo', function (data) {
    console.log("clientinfo", data);
    ottd_clients[data.id] = data;
});

ottdConnection.on('clientupdate', function (data) {
    console.log("clientupdate", data);
});


// COMPANIES

ottdConnection.on('companyinfo', function (data) {
    console.log("companyinfo", data);  
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