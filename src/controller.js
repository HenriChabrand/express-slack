const FileStore = require('./filestore'),
      EventEmitter = require('events'),
      client = require('./client'),
      Bot = require('./bot');


class Controller extends EventEmitter {

  /**
   * Constructor
   *
   * @param {object} settings - Middleware settings set by user
   */
  constructor(settings) {
    super();

    this.settings = settings;
    this.store = settings.store;

    // use a file store if a path is passed in
    if (typeof(this.store) === 'string') 
      this.store = new FileStore(this.store);

    // connect bots
    this.store.all().then(auths => {
      Object.keys(auths).forEach(team_id => {
        let auth = auths[team_id];
        if (auth.bot) this.connect(auths[team_id]);
      });
    });
  }

  /**
   * OAuth Middleware
   *
   * @param {Request} req - The express request object
   * @param {Response} res - The express response object
   */
  oauth(req, res) {
    let {code} = req.query || {};
    
    if (code) {
      let params = Object.assign({}, this.settings, { code: code });
      client.install(params).catch(e => res.json(e)).then(info => {    
        delete info.ok;
        this.store.save(info.team_id, info);
        res.redirect(info.url);
      });
    } else {
      let url = client.authorizeUrl(this.settings);
      res.redirect(url); // authorize
    }
  }

  /**
   * Token Verification Middleware
   *
   * @param {Request} req - The express request object
   * @param {Response} res - The express response object
   */
  verification(req, res, next) {
    let {token} = this.settings
    if (!token || token === req.body.token) {
      this.emit('url_verification', true, req.body);
      next();
    } else {
      this.emit('url_verification', false, req.body);
      res.sendStatus(401);
    }
  }

  /**
   * Events API Challenge Middleware
   *
   * @param {Request} req - The express request object
   * @param {Response} res - The express response object
   */
  challenge(req, res, next) {
    if (req.body.challenge) {
      this.emit('challenge', req.body);
      res.send(req.body.challenge);
    } else {
      next();
    }
  }

  /**
   * Message Digest Middleware
   *
   * @param {Request} req - The express request object
   * @param {Response} res - The express response object
   */
  message(req, res) {
    res.send('');
    this.store.get(req.body.team_id).then(auth => {
      this.digest(auth, req.body);
    });
  }

  /**
   * Start RTM
   *
   * @param {function} callback - A callback containing the websocket
   */
  connect(auth) {
    let {team_id, bot} = auth;
    let params = { token: bot.bot_access_token };

    client.rtm(params).then(ws => {
      ws.on('open', () => {
        // this.bots[team_id] = ws;
        this.emit('connected', this);
      });
      ws.on('close', () => {
        // delete this.bots[team_id];
        this.emit('disconnected', this);
      });
      ws.on('message', this.digest.bind(this));
    }).catch(console.error);
  }

  /**
   * Digest a Slack message and process events
   *
   * @param {object|string} message - The incoming Slack message
   * @return {Message} The parsed message
   */
  digest(auth, message) {
    message = this.parse(message);
    let bot = new Bot(auth, message);
    let {event_ts, event, command, type, trigger_word, payload, team_id} = message;

    // wildcard
    this.emit('*', message, bot);

    // notify incoming message by type
    if (type) this.emit(type, message, bot);

    // notify slash command by command
    if (command) {
      this.emit('slash_command', message, bot);
      this.emit(command, message, bot);
    }

    // notify event triggered by event type
    if (event) {
      this.emit('event', message, bot);
      this.emit(event.type, message, bot);
    }

    // notify webhook triggered by trigger word
    if (trigger_word) {
      this.emit('webhook', message, bot);
      this.emit(trigger_word, message, bot);
    }

    // notify message button triggered by callback_id
    if (payload) {
      this.emit('interactive_message', payload, bot);
      this.emit(payload.callback_id, payload, bot);
    }
  }

  /**
   * Parse a Slack message
   *
   * @param {object|string} message - The incoming Slack message
   * @return {Message} The parsed message
   */
  parse(message) {
    if (typeof message === 'string') {
      try { message = JSON.parse(message); }      // JSON string
      catch(e) { message = qs.parse(message); }   // QueryString
    }
    
    // message button payloads are JSON strings
    if (typeof message.payload === 'string') 
      message.payload = JSON.parse(message.payload);
    
    return message;
  }
}

module.exports = Controller;