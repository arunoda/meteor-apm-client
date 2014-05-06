var Fibers = Npm.require('fibers');
var eventLogger = Npm.require('debug')('apm:tracer');
var REPITITIVE_EVENTS = {'db': true, 'http': true, 'email': true, 'wait': true, 'async': true};

function Tracer() {

};

//In the future, we might wan't to track inner fiber events too.
//Then we can't serialize the object with methods
//That's why we use this method of returning the data
Tracer.prototype.start = function(session, msg) {
  var traceInfo = {
    _id: session.id + "::" + msg.id,
    session: session.id,
    userId: session.userId,
    id: msg.id,
    events: []
  };

  if(msg.msg == 'method') {
    traceInfo.type = 'method';
    traceInfo.name = msg.method;
  } else if(msg.msg == 'sub') {
    traceInfo.type = 'sub';
    traceInfo.name = msg.name;
  } else {
    return null;
  }

  return traceInfo;
};

Tracer.prototype.event = function(traceInfo, type, data) {
  // do not allow to proceed, if already completed or errored
  var lastEvent = this.getLastEvent(traceInfo);
  if(lastEvent && ['complete', 'error'].indexOf(lastEvent.type) >= 0) {
    return false;
  }

  //expecting a end event
  var eventId = true;

  //specially handling for repitivive events like db, http
  if(REPITITIVE_EVENTS[type]) {
    //can't accept a new start event
    if(traceInfo._lastEventId) {
      return false;
    }
    eventId = traceInfo._lastEventId = Random.id();
  }

  var event = {type: type, at: Apm.syncedDate.getTime()};
  if(data) {
    event.data = data;
  }

  traceInfo.events.push(event);

  eventLogger("%s %s", type, traceInfo._id);
  return eventId;
};

Tracer.prototype.eventEnd = function(traceInfo, eventId, data) {
  if(traceInfo._lastEventId && traceInfo._lastEventId == eventId) {
    var lastEvent = this.getLastEvent(traceInfo);
    var type = lastEvent.type + 'end';
    var event = {type: type, at: Apm.syncedDate.getTime()};
    if(data) {
      event.data = data;
    }
    traceInfo.events.push(event);
    eventLogger("%s %s", type, traceInfo._id);

    traceInfo._lastEventId = null;
    return true;
  } else {
    return false;
  }
};

Tracer.prototype.getLastEvent = function(traceInfo) {
  return traceInfo.events[traceInfo.events.length -1]
};

Tracer.prototype.endLastEvent = function(traceInfo) {
  var lastEvent = this.getLastEvent(traceInfo);

  if(lastEvent && !/end$/.test(lastEvent.type)) {
    traceInfo.events.push({
      type: lastEvent.type + 'end',
      at: Apm.syncedDate.getTime()
    });
  }
};

Tracer.prototype.buildTrace = function(traceInfo) {
  var firstEvent = traceInfo.events[0];
  var lastEvent = traceInfo.events[traceInfo.events.length - 1];
  var processedEvents = [];

  if(firstEvent.type != 'start') {
    console.warn('APM: trace is not started yet');
    return null;
  } else if(lastEvent.type != 'complete' && lastEvent.type != 'error') {
    //trace is not completed or errored yet
    console.warn('APM: trace is not completed or errored yet');
    return null;
  } else {
    //build the metrics
    traceInfo.errored = lastEvent.type == 'error';
    traceInfo.at = firstEvent.at;

    var metrics = {
      total: lastEvent.at - firstEvent.at,
    };

    var totalNonCompute = 0;

    firstEvent = ['start', 0];
    if (traceInfo.events[0].data) firstEvent.push(traceInfo.events[0].data);
    processedEvents.push(firstEvent);

    for(var lc=1; lc < traceInfo.events.length - 1; lc += 2) {
      var prevEventEnd = traceInfo.events[lc-1];
      var startEvent = traceInfo.events[lc];
      var endEvent = traceInfo.events[lc+1];
      var computeTime = startEvent.at - prevEventEnd.at;
      if (computeTime > 0) processedEvents.push(['compute', computeTime]);
      if(!endEvent) {
        console.error('APM: no end event for type: ', startEvent.type);
        return null;
      } else if(endEvent.type != startEvent.type + 'end') {
        console.error('APM: endevent type mismatch: ', startEvent.type, endEvent.type, JSON.stringify(traceInfo));
        return null;
      } else {
        var elapsedTimeForEvent = endEvent.at - startEvent.at
        var currentEvent = [startEvent.type, elapsedTimeForEvent];
        currentEvent.push(_.extend({}, startEvent.data, endEvent.data));
        processedEvents.push(currentEvent);
        metrics[startEvent.type] = metrics[startEvent.type] || 0;
        metrics[startEvent.type] += elapsedTimeForEvent;
        totalNonCompute += elapsedTimeForEvent;
      }
    }

    computeTime = lastEvent.at - traceInfo.events[traceInfo.events.length - 2];
    if (computeTime > 0) processedEvents.push(['compute', computeTime]);
    processedEvents.push([lastEvent.type, 0, lastEvent.data]);

    metrics.compute = metrics.total - totalNonCompute;
    traceInfo.metrics = metrics;
    traceInfo.events = processedEvents;
    traceInfo.isEventsProcessed = true;
    return traceInfo;
  }
};

Apm.tracer = new Tracer();