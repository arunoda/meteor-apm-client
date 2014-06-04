Kadira (formerly meteor-apm)
==========

[![Kadira - Application Performance Monitoring for Meteor](https://kadira.io/images/intro.png)](https://kadira.io)

Getting started
---------------

1. Create an account at http://kadira.io
2. From the UI, create an app. You'll get an `AppId` and an `AppSecret`.
3. Run `mrt add kadira` in your project
4. Configure the apm package with the `AppId` and `AppSecret`, by adding the following code snippet to a `server/kadira.js` file:

        Meteor.startup(function() {
          Kadira.connect('<AppId>', '<AppSecret>');
        });

5. Now you can deploy your application and it will send information to Kadira as soon as it is connected. It will take up to one minute for metrics to be available, since Kadira aggregates data by the minute.

Upgrading from APM
------------------

1. `mrt remove apm`
2. `mrt install kadira`
3. Edit `server/apm.js` and replace `Apm.` with `Kadira.`. Optionally rename `apm.js` to `kadira.js`.

More information
----------------

Check out the [Knowledge Base](http://support.meteorapm.com/knowledgebase).
