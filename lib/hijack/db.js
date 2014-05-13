var mongoConnectionProto = getMongoConnectionProto();

//findOne is handled by find - so no need to track it
//upsert is handles by update
['find', 'update', 'remove', 'insert', '_ensureIndex', '_dropIndex'].forEach(function(func) {
  var originalFunc = mongoConnectionProto[func];
  mongoConnectionProto[func] = function(collName, selector, mod, options) {
    var payload = {
      coll: collName,
      func: func,
    };

    if(func == 'insert') {
      //add nothing more to the payload
    } else if(func == '_ensureIndex' || func == '_dropIndex') {
      //add index
      payload.index = JSON.stringify(selector);
    } else if(func == 'update' && options.upsert) {
      payload.func = 'upsert';
      payload.selector = JSON.stringify(selector);
    } else {
      //all the other functions have selectors
      payload.selector = JSON.stringify(selector);
    }

    var apmInfo = Apm._getInfo();
    if(apmInfo) {
      var eventId = Apm.tracer.event(apmInfo.trace, 'db', payload);
    }

    //this cause V8 to avoid any performance optimizations, but this is must to use
    //otherwise, if the error adds try catch block our logs get messy and didn't work
    //see: issue #6
    try{
      var ret = originalFunc.apply(this, arguments);
      //handling functions which can be triggered with an asyncCallback
      var endOptions = {};

      if(HaveAsyncCallback(arguments)) {
        endOptions.async = true;
      }

      if(func == 'update') {
        if(options.upsert) {
          endOptions.updatedDocs = ret.numberAffected;
          endOptions.insertedId = ret.insertedId;
        } else {
          endOptions.updatedDocs = ret;
        }
      } else if(func == 'remove') {
        endOptions.removedDocs = ret;
      }

      if(eventId) {
        Apm.tracer.eventEnd(apmInfo.trace, eventId, endOptions);
      }

      if(func == 'find' && !ret.constructor.prototype._ampOk) {
        hijackCursor(ret.constructor.prototype);
      }
    } catch(ex) {
      if(eventId) {
        Apm.tracer.eventEnd(apmInfo.trace, eventId, {err: ex.message});
      }
      throw ex;
    }

    return ret;
  };
});

function hijackCursor(cursorProto) {
  ['forEach', 'map', 'fetch', 'count', 'observeChanges', 'observe', 'rewind'].forEach(function(type) {
    var originalFunc = cursorProto[type];
    cursorProto[type] = function() {
      var cursorDescription = this._cursorDescription;
      var payload = {
        coll: cursorDescription.collectionName,
        selector: JSON.stringify(cursorDescription.selector),
        func: type,
        cursor: true
      };
      if(cursorDescription.options) {
        var options = _.pick(cursorDescription.options, ['fields', 'sort', 'limit']);
        for(var field in options) {
          payload[field] = JSON.stringify(options[field]);
        }
      };

      var apmInfo = Apm._getInfo();
      if(apmInfo) {
        var eventId = Apm.tracer.event(apmInfo.trace, 'db', payload);
      }

      try{
        var ret = originalFunc.apply(this, arguments);

        var endData = {};
        if(type == 'observeChanges' || type == 'observe') {
          endData.oplog = false;
          if(ret._multiplexer) {
            endData.noOfHandles = Object.keys(ret._multiplexer._handles).length;
            // track the cache handlers
            if(apmInfo && apmInfo.trace.type == 'sub') {
              var isCachedHandle = endData.noOfHandles > 1;
              Apm.models.pubsub.incrementHandleCount(apmInfo.trace.name, isCachedHandle);
            }

            // older meteor versions done not have an _multiplexer value
            if(ret._multiplexer._observeDriver) {
              var observerDriverClass = ret._multiplexer._observeDriver.constructor;
              var usesOplog = typeof observerDriverClass.cursorSupported == 'function';
              endData.oplog = usesOplog;
              var size = 0;
              ret._multiplexer._cache.docs.forEach(function() {size++});
              endData.noOfCachedDocs = size;
            }
          }
        } else if(type == 'fetch' || type == 'map'){
          //for other cursor operation
          endData.docsFetched = ret.length;
        }

        if(eventId) {
          Apm.tracer.eventEnd(apmInfo.trace, eventId, endData);
        }
        return ret;
      } catch(ex) {
        if(eventId) {
          Apm.tracer.eventEnd(apmInfo.trace, eventId, {err: ex.message});
        }
        throw ex;
      }
    };
  });

  cursorProto._ampOk = true;
}

function getMongoConnectionProto() {
  var coll = new Meteor.Collection('__apm_dummy_collection__');
  //we need wait until db get connected with meteor, .findOne() does that
  coll.findOne();
  return MongoInternals.defaultRemoteCollectionDriver().mongo.constructor.prototype;
}