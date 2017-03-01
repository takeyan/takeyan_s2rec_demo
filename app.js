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

//-----S.T. Cloudant --------------
var Cloudant = require("cloudant");
var dbname = "minutes";

if (typeof process.env.VCAP_SERVICES === 'undefined') {
    credentials = require('./cloudant.json');
    } else {
    var services = JSON.parse(process.env.VCAP_SERVICES)
    credentials = services['cloudantNoSQLDB'][0].credentials;
    };
var username = credentials.username;
var password = credentials.password;
var cloudant = Cloudant({account:username, password:password, plugin:'retry'});
// cloudant.db.destroy(dbname);
// cloudant.db.create(dbname);
var s2srecdb = cloudant.db.use(dbname);
//---------------------------------------

//-----S.T. Alchemy Language --------------
// If no API Key is provided here, the watson-developer-cloud@2.x.x library will check for an ALCHEMY_LANGUAGE_API_KEY environment property and then fall back to the VCAP_SERVICES property provided by Bluemix.
var alchemyLanguage = new watson.AlchemyLanguageV1({
 api_key: "da89db9f55afbba8c98ba01551b6149a53840714"
});
//------------------------------------------------------



app.use(bodyParser.urlencoded({ extended: false }));


//------Personality Insights------------
var PersonalityInsightsV3 = require('watson-developer-cloud/personality-insights/v3');
var personality_insights = new PersonalityInsightsV3({
   username: '8e6e7927-3343-491b-9932-81a81835f4a5',
   password: 'XgTNfJyoEkIt',
   version_date: '2016-10-20'
});
//----------------------------------------------

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
      console.log('### error at getToken:', JSON.stringify(credentials));  //S.T.
      console.log('### error at getToken:', err);
      res.status(err.code);
    }
    res.send(token);
  });
});

//-----------ブラウザからPersonality Insightsを呼び出す（サンバーストチャートの描画用）----------------------------

app.post('/pi-analyze', function(req, res) {
 
// console.log("### Input BODY is: " + JSON.stringify(req.body));
// console.log("### Input Text is: " + req.body.text);

// S.T. 語数が120より少ない時、文章を繰り返しコピーして語数を増やす
var wordCount = req.body.text.split(" ").length;
var inputText = req.body.text;
if(wordCount<120){
    for (var i=0 ; i<120/wordCount+1 ; i++){
        inputText = inputText + req.body.text;
    }
}

// console.log("### Word count is: " + wordCount + ", Repeat is: " + 120/wordCount+1 + ", Input Text is:" + inputText);

var contentItems = Array();
contentItems[0] = {
   "content": inputText, 
   "contenttype": "text/plain", 
   "created": 1447639154000,
   "id": "666073008692314113",
   "language": "ja"
 };

var params = {
  // Get the content items from the JSON file.
  content_items: contentItems,
  consumption_preferences: true,
  raw_scores: true,
  headers: {
    'accept-language': 'ja',
    'accept': 'application/json'
  }
};

personality_insights.profile(params, function(error, response) {
  if (error)
    console.log('Error:', error);
  else
    console.log(JSON.stringify(response, null, 2));
       res.header("Content-Type", "application/json; charset=utf-8");
       res.send(response);
  }
);
});

//-----------------------------------------------------------------------------------------------------------------






// L.R.
// ------------------------------- MT ---------------------------------
// app.use(bodyParser.urlencoded({ extended: false })); // S.T.  29行目に移動

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
  //
  // 順次処理のため、Language Translatorのcallbackの中でAlchemy Languageを呼び、Alchemy Languageのcallbackの中でPersonality
  // Insightsを呼び、Personality Insightsのcallbackの中でCloudantを呼んでいる。
  //
  var src = params.model_id.substring(0,2);         // S.T. 新Language Translator対応
  var tgt = params.model_id.substring(3,5);          // S.T. 新Language Translator対応
  var params2 = {    text: params.text,    source: src,    target: tgt };         // S.T. 新Language Translator対応
  //  console.log('##### ---> params2 == ' + JSON.stringify(params2)); //S.T

  language_translation.translate(params2, function(err, models) {
  if (err) {
 console.log('##### err in LT:'+err); //S.T
    return next(err);
 } else {
 console.log('##### models:'+JSON.stringify(models)); //S.T
 console.log('##### translation:'+ models.translations[0].translation); //S.T
    res.json(models);

//---S.T. Call Alchemy Language-------------------
var str;
if (src === 'en') str = params2.text;
else str = models.translations[0].translation;

var alchemyParams = {
  text:str,
  knowledgeGraph:1,
  emotion:1,
  sentiment:1
};

alchemyLanguage.keywords(alchemyParams, function(err, response) {
      if (err) {
        return next('##### err in AL:' + err);
      }
      else {

//---S.T. Personality Insights呼び出し用関数-------------------
var dt1 = alchemyParams.text;
// S.T. 語数が120より少ない時、文章を繰り返しコピーして語数を増やす
var wordCount = dt1.split(" ").length;
var inputText = dt1;
if(wordCount<120){
    for (var i=0 ; i<120/wordCount+1 ; i++){
        inputText = inputText + dt1;
    }
}
// console.log("### Word count is: " + wordCount + ", Repeat is: " + 120/wordCount+1 + ", Input Text is:" + inputText);
var contentItems = Array();
contentItems[0] = {
   "content": inputText, 
   "contenttype": "text/plain", 
   "created": 1447639154000,
   "id": "666073008692314113",
   "language": "en"
 };

var PIparams = {
  content_items: contentItems,
  consumption_preferences: true,
  raw_scores: true,
  headers: {
    'accept-language': 'ja',
    'accept': 'application/json'
  }
};

personality_insights.profile(PIparams, function(error, PIresponse) {
  if (error)
    console.log('### Error:' + error);
  else{
    console.log('### PI response:' + JSON.stringify(PIresponse, null, 2));

//---S.T. Insert to Cloudant----------------------------
        var script = {_id: (new Date()).toISOString(), lang_a: src, script_a: req.body.text, lang_b: tgt, script_b: models.translations[0].translation, keywords:response, PI:PIresponse};
 //      var PIonly = {_id:"PIonly", _rev:"1-fcf8c288988576ae0c23cede237d7857", PI:PIresponse};
       var PIonly = {_id:"PIonly", PI:PIresponse};
       console.log("### Inserting to Cloudant: " + JSON.stringify(script));
       dbInsert(script);
       dbUpdate(PIonly);
     }
});
//---------------------------------------------------------------

    }
});
//---------------------------------------------------------------

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


//---S.T.---------------------------
// Cloudantへのデータインサート用関数     
var dbInsert = function(dt){
    console.log("### Calling Personality Insights:" + dt.script_a);
    s2srecdb.insert(dt, function(err, body, header) {
    if (err) {
        console.log('### Error = ', err.message);
        console.log('### payload = ' + dt);
        }
    });
}

//---S.T.---------------------------
// Cloudantへのアップデート用関数     
var dbUpdate = function(dt){
//    console.log("### Calling Personality Insights:" + dt.script_a);
    s2srecdb.get(dt._id, {revs_info:true}, function(err, body, header) {
    if (err) {
        dbInsert(dt);
        }
     else {
      dt._rev = body._rev;
      console.log("### Updating Cloudant: " + JSON.stringify(dt));
      s2srecdb.insert(dt, function(err, body) {
            if (!err)   console.log("### Cloudant Updated: " + body);
      });
    }
});
}


// 日付フォーマット用関数
function dateFmt(dt){
    return dt.toISOString().replace(/T/," ").replace(/Z/,"");
}
//-----------------------------------




// Add error handling in dev
if (!process.env.VCAP_SERVICES) {
  app.use(errorhandler());
}
var port = process.env.VCAP_APP_PORT || 3000;
app.listen(port);
console.log('listening at:', port);