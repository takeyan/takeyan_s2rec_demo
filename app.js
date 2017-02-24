/**
 * Copyright 2014, 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'),
    app = express(),
	bodyParser = require("body-parser"), //L.R.
    errorhandler = require('errorhandler'),
    bluemix = require('./config/bluemix'),
    watson = require('watson-developer-cloud'),
    path = require('path'),
    // environmental variable points to demo's json config file
    extend = require('util')._extend;

// For local development, put username and password in config
// or store in your environment
var config = {
  version: 'v1',
  url: 'https://stream.watsonplatform.net/speech-to-text/api',
  username: 'user name to access STT service',
  password: 'password to access STT service'
};

// if bluemix credentials exists, then override local
var credentials = extend(config, bluemix.getServiceCreds('speech_to_text'));
var authorization = watson.authorization(credentials);

// redirect to https if the app is not running locally
if (!!process.env.VCAP_SERVICES) {
  app.enable('trust proxy');
  app.use (function (req, res, next) {
    if (req.secure) {
      next();
    } 
    else {
      res.redirect('https://' + req.headers.host + req.url);
    }
  });
}

// Setup static public directory
app.use(express.static(path.join(__dirname , './public')));

// Get token from Watson using your credentials
app.get('/token', function(req, res) {
  authorization.getToken({url: credentials.url}, function(err, token) {
    if (err) {
      console.log('error:', err);
      res.status(err.code);
    }
    res.send(token);
  });
});

// L.R.
// ------------------------------- MT ---------------------------------
app.use(bodyParser.urlencoded({ extended: false }));

var mt_credentials = extend({
  url: 'https://gateway.watsonplatform.net/language-translator/api', // S.T. 新Language Translator対応
  username: 'user name to access MT service',
  password: 'password to access MT service',
  version: 'v2'
}, bluemix.getServiceCreds('language_translator')); // VCAP_SERVICES  // S.T. 新Language Translator対応

// console.log('##### bluemix.getServiceCreds=' + bluemix.getServiceCreds('language_translator'));

var language_translation = watson.language_translation(mt_credentials);
// console.log("##### var language_translation = watson.language_translator(mt_credentials)");



app.post('/api/translate', function(req, res, next) {
 // console.log('/v2/translate');
  
  var params = extend({ 'X-WDC-PL-OPT-OUT': req.header('X-WDC-PL-OPT-OUT')}, req.body);
 
  // 旧Lnaguage Translationの引数のparamsオブジェクトは、params.textに翻訳への入力文、params.model_idに"en-fr-conversational"の
  // ように翻訳方法がセットされている。
  // Language Translatorは、text: params.text,    source: 'ja',    target: 'en' という形式のJSONオブジェクトを引数とするので、
  // 翻訳方法の部分はmodel_idから先頭2バイトを抽出してsourceにセット、最初のハイフン直後の2バイト（オフセット3からオフセット5の手前まで）
  // を抽出してtargetにセットして使用する。
  var src = params.model_id.substring(0,2);         // S.T. 新Language Translator対応
  var tgt = params.model_id.substring(3,5);          // S.T. 新Language Translator対応
  var params2 = {    text: params.text,    source: src,    target: tgt };         // S.T. 新Language Translator対応
  //  console.log('##### ---> params2 == ' + JSON.stringify(params2)); //S.T

  language_translation.translate(params2, function(err, models) {
  if (err) {
 console.log('##### err:'+err); //S.T
    return next(err);
 } else {
// console.log('##### models:'+JSON.stringify(models)); //S.T
    res.json(models);
}    
  });
});


// L.R.
// -------------------------------- TTS ---------------------------------
var tts_credentials = extend({
  url: 'https://stream.watsonplatform.net/text-to-speech/api',
  version: 'v1',
  username: 'user name to access TTS service',
  password: 'password to access TTS service',
}, bluemix.getServiceCreds('text_to_speech'));

// Create the service wrappers
var textToSpeech = watson.text_to_speech(tts_credentials);

app.get('/synthesize', function(req, res) {
  var transcript = textToSpeech.synthesize(req.query);
  transcript.on('response', function(response) {
    if (req.query.download) {
      response.headers['content-disposition'] = 'attachment; filename=transcript.ogg';
    }
  });
  transcript.on('error', function(error) {
    console.log('Synthesize error: ', error)
  });
  transcript.pipe(res);
});

// ----------------------------------------------------------------------

// Add error handling in dev
if (!process.env.VCAP_SERVICES) {
  app.use(errorhandler());
}
var port = process.env.VCAP_APP_PORT || 3000;
app.listen(port);
console.log('listening at:', port);