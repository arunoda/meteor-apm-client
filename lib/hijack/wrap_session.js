//only method, sub and unsub are valid messages
//so following fields would only required
var WAITON_MESSAGE_FIELDS = ['msg', 'id', 'method', 'name'];

wrapSession = function(sessionProto) {

  //store the currently running DDP message per session
  //we have to add this to the top of the waiting message
  var currentlyProcessingDDPMessage = {};

  var originalProcessMessage = sessionProto.processMessage;
  sessionProto.processMessage = function(msg) {
    if(Apm.connected) {
      //only add apmInfo if it is connected
      var apmInfo = {
        session: this.id,
        userId: this.userId
      };

      if(msg.msg == 'method' || msg.msg == 'sub') {
        apmInfo.trace = Apm.tracer.start(this, msg);

        var waitOnMessages = this.inQueue.map(function(msg) {
          return _.pick(msg, WAITON_MESSAGE_FIELDS);
        });

        //add currently processing ddp message if exists
        if(this.workerRunning) {
          waitOnMessages.unshift(_.pick(currentlyProcessingDDPMessage[this.id], WAITON_MESSAGE_FIELDS));
        }

        //use JSON stringify to save the CPU
        var startData = { userId: this.userId, params: JSON.stringify(msg.params) };
        Apm.tracer.event(apmInfo.trace, 'start', startData);
        var waitEventId = Apm.tracer.event(apmInfo.trace, 'wait', {waitOn: waitOnMessages}, apmInfo);
        msg._waitEventId = waitEventId;
        msg.__apmInfo = apmInfo;

        if(msg.msg == 'sub') {
          // start tracking inside processMessage allows us to indicate
          // wait time as well
          Apm.models.pubsub._trackSub(this, msg);
        }
      }
    }

    return originalProcessMessage.call(this, msg);
  };

  //adding the method context to the current fiber
  var originalMethodHandler = sessionProto.protocol_handlers.method;
  sessionProto.protocol_handlers.method = function(msg, unblock) {
    currentlyProcessingDDPMessage[this.id] = msg;
    //add context
    var apmInfo = msg.__apmInfo;
    Apm._setInfo(apmInfo);

    Apm.tracer.eventEnd(apmInfo.trace, msg._waitEventId);

    return originalMethodHandler.call(this, msg, unblock);
  };

  //to capture the currently processing message
  var orginalSubHandler = sessionProto.protocol_handlers.sub;
  sessionProto.protocol_handlers.sub = function(msg, unblock) {
    currentlyProcessingDDPMessage[this.id] = msg;

    //add context
    var apmInfo = msg.__apmInfo;
    Apm._setInfo(apmInfo);

    Apm.tracer.eventEnd(apmInfo.trace, msg._waitEventId);

    return orginalSubHandler.call(this, msg, unblock);
  };

  //to capture the currently processing message
  var orginalUnSubHandler = sessionProto.protocol_handlers.unsub;
  sessionProto.protocol_handlers.unsub = function(msg, unblock) {
    currentlyProcessingDDPMessage[this.id] = msg;
    return orginalUnSubHandler.call(this, msg, unblock);
  };

  //we need to clear currentlyProcessingDDPMessage just after the session destroyed
  //otherwise, it will leads to a potential memory leaks
  var originalDestroy = sessionProto.destroy;
  sessionProto.destroy = function() {
    delete currentlyProcessingDDPMessage[this.id];
    return originalDestroy.call(this);
  };

  //track method ending (to get the result of error)
  var originalSend = sessionProto.send;
  sessionProto.send = function(msg) {
    if(msg.msg == 'result') {
      var apmInfo = Apm._getInfo();
      if(msg.error) {
        var error = msg.error;

        //pick the error from the __apmInfo if setted with
        //DDPServer._CurrentWriteFence.withValue hijack
        if(apmInfo && apmInfo.currentError) {
          error = apmInfo.currentError;
        }
        error = _.pick(error, ['message', 'stack']);

        Apm.tracer.endLastEvent(apmInfo.trace);
        Apm.tracer.event(apmInfo.trace, 'error', {error: error});
      } else {
        var isForced = Apm.tracer.endLastEvent(apmInfo.trace);
        if (isForced) {
          console.warn('APM endevent forced complete', JSON.stringify(apmInfo.trace.events));
        };
        Apm.tracer.event(apmInfo.trace, 'complete');
      }

      if(apmInfo) {
        //processing the message
        var trace = Apm.tracer.buildTrace(apmInfo.trace);
        Apm.models.methods.processMethod(trace);

        //clean and make sure, fiber is clean
        //not sure we need to do this, but a preventive measure
        Apm._setInfo(null);
      }
    }

    return originalSend.call(this, msg);
  };

  //for the pub/sub data-impact calculation
  ['sendAdded', 'sendChanged', 'sendRemoved'].forEach(function(funcName) {
    var originalFunc = sessionProto[funcName];
    sessionProto[funcName] = function(collectionName, id, fields) {
      //fields is not relevant for `sendRemoved`, but does make any harm
      var eventName = funcName.substring(4).toLowerCase();
      var subscription = Apm.env.currentSub.get();

      if(subscription) {
        var session = this;
        Apm.models.pubsub._trackNetworkImpact(session, subscription, eventName, collectionName, id, fields);
      }

      return originalFunc.call(this, collectionName, id, fields);
    };
  });
};

//We need this hijack to get the correct exception from the method
//otherwise, what we get from the session.send is something customized for the client

var originalWithValue = DDPServer._CurrentWriteFence.withValue;
DDPServer._CurrentWriteFence.withValue = function(value, func) {
  try {
    return originalWithValue.call(DDPServer._CurrentWriteFence, value, func);
  } catch(ex) {
    if(Apm._getInfo()) {
      Apm._getInfo().currentError = ex;
    }
    throw ex;
  }
};
