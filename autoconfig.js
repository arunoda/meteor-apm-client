
Meteor.startup(function () {
  console.warn('APM: Trying to connect');
  if(process.env.KADIRA_APP_ID && process.env.KADIRA_APP_SECRET) {
    console.warn('APM: connected using environment variables');
    Apm.connect(process.env.KADIRA_APP_ID, process.env.KADIRA_APP_SECRET);
    Apm.connect = function () {
      throw new Error('APM: already connected using environment variables');
    }
  } else if(Meteor.settings.KADIRA_APP_ID && Meteor.settings.KADIRA_APP_SECRET) {
    console.warn('APM: connected using environment variables');
    Apm.connect(Meteor.settings.KADIRA_APP_ID, Meteor.settings.KADIRA_APP_SECRET);
    Apm.connect = function () {
      throw new Error('APM: already connected using Meteor.settings');
    }
  }
});
