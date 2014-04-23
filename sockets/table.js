var Deck = require('./deck.js');
var Ranker = require('handranker');

function Table(blind, limit, buyIn, io) {
  this.maxPlayers = 7;
  this.blind = blind;
  this.limit = limit;
  this.players = [];
  this.cards = [];
  this.currentBet = blind;
  this.betQueue = [];
  this.io = io;
  this.pot = 0;
  this.numPlayers = 0;
  this.curPlayer;
  this.dealer = 0;
}



// Start a game
Table.prototype.startGame = function() {
    // activate players
    this.activatePlayers();
    
    // announce dealer
    
    // set the deck
    this.deck = new Deck();
    
    // deal some hands
    this.dealPlayers();
    
    // set up bet queue
    this.constructQueue(this.dealer);
    
    // auto bet for the first two - small, then big blind - requeue small blind
    this.issueBlind(1);
    this.issueBlind(2);
    
    // now that this is done, we shift to bet phase
    this.getBet();
}

// show the latest player
Table.prototype.showPlayer = function(pid) {
    for (player in this.players) {
        if (this.players[player].id == pid) {
            this.io.sockets.emit('getPlayer', 
                            { id: this.players[player].id
                            , bank: this.players[player].bank
                            , name: this.players[player].name });
        }
    }
}

// alert everyone to players in the table
Table.prototype.showPlayers = function(pid) {
    for (i = 0; i < this.numPlayers; i++) { 
        this.io.sockets.socket(pid).emit('getPlayer', 
                                    { id: this.players[i].id
                                    , bank: this.players[i].bank
                                    , name: this.players[i].name });
    }
}


// deal a round of cards to a table
Table.prototype.dealPlayers = function() {

    //draw cards for all players
    for (i = 0; i < this.players.length; i++) {
        for (player in this.players) {
            this.players[player].setHand(this.deck.drawCard());
        }
    }
    
    // Send the hands, add to betting queue
    for (player in this.players) {
        var hand = this.players[player].getHand()
        this.io.sockets.socket(this.players[player].id).emit('getHand', hand);
    }
}

// set up a queue to track bets
Table.prototype.constructQueue = function() {
    var i = (this.dealer+1)%this.numPlayers;

    // push all but the dealer
    while (i != this.dealer) {
        if (this.players[i].getActive()) this.betQueue.push(i);
        i = (i+1)%this.numPlayers;
    }
    
    // push dealer last
    if (this.players[this.dealer].getActive()) this.betQueue.push(this.dealer);
 
}

// set all player statuses to active
Table.prototype.activatePlayers = function() {
    for (player in this.players) {
        this.players[player].setActive(true);
    }
}

// Function to handle posting a blind
Table.prototype.issueBlind = function(type) {
    var player = this.betQueue.shift();
    var bet;
    this.io.sockets.emit('betting', {pid: this.players[player].id});
    if (type == 1) bet = this.blind/2;
    else bet = this.blind;
    this.players[player].setBet(bet);
    this.players[player].setBank(bet);
    this.pot += bet;
    this.io.sockets.emit('bet', { amount: bet, player: this.players[player].id });
    this.betQueue.push(player);
}

// ask for the next bet from player
Table.prototype.getBet = function() {
    this.curPlayer = this.betQueue.shift();
    this.io.sockets.emit('betting', {pid: this.players[this.curPlayer].id});
    this.io.sockets.socket(this.players[this.curPlayer].id).emit('alert', {text: 'It is your turn to bet'});
}
        
// take a bet
Table.prototype.takeBet = function(data) {
    // set their bet and bank
    var bet;
    
    this.players[this.curPlayer].setBet(data.amount);
    this.players[this.curPlayer].setBank(-data.amount);
    this.pot += data.bet;
    
    if (data.fold) { // we need to fold in this bet
        this.io.sockets.emit('fold', {player: data.player});
        this.players[this.curPlayer].setBet(0);
        this.players[this.curPlayer].setActive(false);
        
    } else { // alert to bet
        this.io.sockets.emit('bet', {player: data.player, amount: data.amount});
    }
    
    // if this bet = next, we've hit the end
    if (data.amount == this.players[this.betQueue[0]].getBet()) {
        // reset the bet queue
        // reset current bet and player bets
        this.currentBet = 0;
        this.betQueue = [];
        for (player in this.players) {
            this.players[player].setBetZero();
        }
        if (this.cards.length!=0) {
             if (this.cards.length == 3) { // deal turn
                this.showTurn();
                this.constructQueue();
                this.getBet()
            } else if (this.cards.length == 4) { // deal river
                this.showRiver();
                this.constructQueue();
                this.getBet();
            } else { // end of game
                var winner = this.findWinner();
                var winIndex = this.getPlayer(winner);
                //io.sockets.emit('winner', {pid: winner});
                this.io.sockets.emit('alert', {text: 'The winner is ' + this.players[this.getPlayer(winner)].getName()});
                this.io.sockets.socket(winner).emit('winner');
            }
            
        } else { // we deal flop
            this.showFlop();
            this.constructQueue();
            this.getBet();
        }
        
    } else {
        // repush to end, set bet, move on
        this.betQueue.push(this.curPlayer);
        this.currentBet = data.amount;
        this.getBet();
    }
    
}

/****Player management*****/



// add a player to a table
Table.prototype.addPlayer = function(player) {
    this.players[this.numPlayers++] = player;
}




// get player index by id
Table.prototype.getPlayer = function(pid) {
    for (var i = 0; i < this.numPlayers; i++) {
        if (this.players[i].id = pid) {
            return i;
        }
    }
}

// Aww, they give up
Table.prototype.fold = function() {
    
}

// get blind
Table.prototype.getBlind = function() {
    return this.blind;
}



// Card management

Table.prototype.showFlop = function() {
    this.cards[0] = this.deck.drawCard();
    this.io.sockets.emit('card', {card:this.cards[0]});
    this.cards[1] = this.deck.drawCard();
    this.io.sockets.emit('card', {card:this.cards[1]});
    this.cards[2] = this.deck.drawCard();
    this.io.sockets.emit('card', {card:this.cards[2]});
}

Table.prototype.showTurn = function() {
    this.cards[3] = this.deck.drawCard();
    this.io.sockets.emit('card', {card:this.cards[3]});
}

Table.prototype.showRiver = function() {
    this.cards[4] = this.deck.drawCard();
    this.io.sockets.emit('card', {card:this.cards[4]});

}


Table.prototype.findWinner = function() {
    var hands = [];
    for (player in this.players) {
        hands[player] = {id: this.players[player].id, cards: this.players[player].getHand()};
    }
    var ranking = Ranker.orderHands(hands, this.cards);
    return ranking[0][0].id;
}

module.exports = Table;
