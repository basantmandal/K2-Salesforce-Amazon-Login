/**
 * Amazon Login - Using SFRA
 * Last Updated 05-July-2021
 *
 * ++++++++++++++++++ SETTINGS +++++++++++++++++++++
 * Scopes :- email,profile,openid
 * Authorization URL :- https://www.amazon.com/ap/oa
 * Token URL :- https://api.amazon.com/auth/o2/token
 * User Info URL:- https://api.amazon.com/user/profile
 * User Info URL Access Token Name:- access_token
 * Redirect Pipeline Name - OAuthReentryAmazon
 * ++++++++++++++++++++++++++++++++++++++++++++++++
 */
server.get('OAuthReentryAmazon', server.middleware.https, consentTracking.consent, function (req, res, next) {
  var URLUtils          = require('dw/web/URLUtils');
  var oauthLoginFlowMgr = require('dw/customer/oauth/OAuthLoginFlowMgr');
  var CustomerMgr       = require('dw/customer/CustomerMgr');
  var Transaction       = require('dw/system/Transaction');
  var Resource          = require('dw/web/Resource');
  var destination       = req.session.privacyCache.store.oauthLoginTargetEndPoint;

  var finalizeOAuthLoginResult = oauthLoginFlowMgr.finalizeOAuthLogin();
  if (!finalizeOAuthLoginResult) {
    res.redirect(URLUtils.url('Login-Show'));
    return next();
  }

  var response        = finalizeOAuthLoginResult.userInfoResponse.userInfo;
  var oauthProviderID = finalizeOAuthLoginResult.accessTokenResponse.oauthProviderId;

  if (!oauthProviderID) {
    res.render('/error', {
      error_message: 'Access Token Error',
      message: Resource.msg('error.oauth.login.failure', 'login', null)
    });
    return next();
  }

  if (!response) {
    res.render('/error', {
      error_message: 'No Response - Please Check - User Info URL',
      message: Resource.msg('error.oauth.login.failure', 'login', null)
    });
    return next();
  }

  var rawExternalProfile = response;
  var externalProfile    = JSON.parse(response);

  if (!externalProfile) {
    res.render('/error', {
      error_message: 'Profile Empty Data - Amazon Permission Issue',
      message: Resource.msg('error.oauth.login.failure', 'login', null)
    });
    return next();
  }

  // BUG AMAZON SENDS USER_ID

  var userID = externalProfile.user_id || externalProfile.uid;
  if (!userID) {
    res.render('/error', {
      message2: 'User ID Error - Please Check - User Info URL & Token',
      message: Resource.msg('error.oauth.login.failure', 'login', null)
    });

    return next();
  }

  var authenticatedCustomerProfile = CustomerMgr.getExternallyAuthenticatedCustomerProfile(
    oauthProviderID,
    userID
  );

  if (!authenticatedCustomerProfile) {
    // Lets Create new profile
    Transaction.wrap(function () {
      var newCustomer = CustomerMgr.createExternallyAuthenticatedCustomer(oauthProviderID, userID);

      authenticatedCustomerProfile = newCustomer.getProfile();
      var firstName;
      var lastName;
      var email;

      if (typeof externalProfile.name === 'object') {
        firstName = externalProfile.name.givenName;
        lastName  = externalProfile.name.familyName;
      } else {
        firstName = externalProfile['first-name']
                    || externalProfile.first_name
                    || externalProfile.name;

        lastName = externalProfile['last-name']
                   || externalProfile.last_name
                   || externalProfile.name;
      }

      email = externalProfile['email-address'] || externalProfile.email;

      if (!email) {
        var emails = externalProfile.emails;

        if (emails && emails.length) {
          email = externalProfile.emails[0].value;
        }
      }

      authenticatedCustomerProfile.setFirstName(firstName);
      authenticatedCustomerProfile.setLastName(lastName);
      authenticatedCustomerProfile.setEmail(email);
    });
  }

  var credentials = authenticatedCustomerProfile.getCredentials();
  if (credentials.isEnabled()) {
    Transaction.wrap(function () {
      CustomerMgr.loginExternallyAuthenticatedCustomer(oauthProviderID, userID, false);
    });
  } else {

    res.render('/error', {
      message: Resource.msg('error.oauth.login.failure', 'login', null)
    });

    return next();
  }

  req.session.privacyCache.clear();
  res.redirect(URLUtils.url(destination));
  return next();
});