
Meteor.startup(function () {
  var appId = process.env.KADIRA_APP_ID || Meteor.settings.KADIRA_APP_ID;
  var secret = process.env.KADIRA_APP_SECRET || Meteor.settings.KADIRA_APP_SECRET;
  if(appId && secret) {
    Apm.connect(appId, secret);
    Apm.connect = function () {
      throw new Error('APM: Already connecting using environment variables');
    }
  };
});
