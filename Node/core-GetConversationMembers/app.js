var builder = require('botbuilder');
var restify = require('restify');
var Promise = require('bluebird');
var url = require('url');
var Swagger = require('swagger-client');

// Swagger client for Bot Connector API
var connectorApiClient = new Swagger(
    {
        url: 'https://raw.githubusercontent.com/Microsoft/BotBuilder/master/CSharp/Library/Microsoft.Bot.Connector/Swagger/ConnectorAPI.json',
        usePromise: true
    });

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

// Create chat bot
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Listen for messages
server.post('/api/messages', connector.listen());

// Bot setup
var bot = new builder.UniversalBot(connector, function (session) {
    var message = session.message;
    var conversationId = message.address.conversation.id;

    // when a group conversation message is recieved,
    // get the conversation members using the REST API and print it on the conversation.

    // 1. inject the JWT from the connector to the client on every call
    addTokenToClient(connector, connectorApiClient).then((client) => {
        // 2. override API client host (api.botframework.com) with channel's serviceHost (e.g.: slack.botframework.com)
        var serviceHost = url.parse(message.address.serviceUrl).host;
        client.setHost(serviceHost);
        // 3. GET /v3/conversations/{conversationId}/members
        client.Conversations.Conversations_GetConversationMembers({ conversationId: conversationId })
            .then((res) => printMembersInChannel(message.address, res.obj))
            .catch((error) => console.log('Error retrieving conversation members: ' + error.statusText));
    });
});

bot.on('conversationUpdate', function (message) {
    if (message.membersAdded && message.membersAdded.length > 0) {
        var membersAdded = message.membersAdded
            .map((m) => {
                var isSelf = m.id === message.address.bot.id;
                return (isSelf ? message.address.bot.name : m.name) || '' + ' (Id: ' + m.id + ')';
            })
            .join(', ');

        bot.send(new builder.Message()
            .address(message.address)
            .text('Welcome ' + membersAdded));
    }

    if (message.membersRemoved && message.membersRemoved.length > 0) {
        var membersRemoved = message.membersRemoved
            .map((m) => {
                var isSelf = m.id === message.address.bot.id;
                return (isSelf ? message.address.bot.name : m.name) || '' + ' (Id: ' + m.id + ')';
            })
            .join(', ');

        bot.send(new builder.Message()
            .address(message.address)
            .text('The following members ' + membersRemoved + ' were removed or left the conversation :('));
    }
});

// Helper methods

// Inject the conenctor's JWT token into to the Swagger client
function addTokenToClient(connector, clientPromise) {
    // ask the connector for the token. If it expired, a new token will be requested to the API
    var obtainToken = Promise.promisify(connector.getAccessToken.bind(connector));
    return Promise.all([obtainToken(), clientPromise]).then((values) => {
        var token = values[0];
        var client = values[1];
        client.clientAuthorizations.add('AuthorizationBearer', new Swagger.ApiKeyAuthorization('Authorization', 'Bearer ' + token, 'header'));
        return client;
    });
}

// Create a message with the member list and send it to the conversationAddress
function printMembersInChannel(conversationAddress, members) {
    if (!members || members.length === 0) return;

    var memberList = members.map((m) => '* ' + m.name + ' (Id: ' + m.id + ')')
        .join('\n ');

    var reply = new builder.Message()
        .address(conversationAddress)
        .text('These are the members of this conversation: \n ' + memberList);
    bot.send(reply);
}