// SoundVault — Google Apps Script sync
//
// SETUP: In Apps Script editor → click "+" next to Services → add "Drive API" (v3)
//
// Script Properties (Project Settings → Script Properties):
//   INGEST_SECRET  — must match INGEST_SECRET in Vercel env vars
//   INGEST_URL     — https://your-app.vercel.app/api/ingest
//   FOLDER_ID      — Google Drive folder ID from the folder URL

var AUDIO_EXTENSIONS = ['.wav', '.mp3', '.aiff', '.flac', '.ogg'];

function getExtension(name) {
  if (!name) return '';
  var idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.substring(idx).toLowerCase();
}

function listFiles(folderId) {
  var results = [];
  var pageToken = null;
  do {
    var res = Drive.Files.list({
      q:                        "'" + folderId + "' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'",
      fields:                   'nextPageToken,files(id,name,size,modifiedTime,webViewLink)',
      pageSize:                 1000,
      includeItemsFromAllDrives: true,
      supportsAllDrives:        true,
      corpora:                  'allDrives',
      pageToken:                pageToken
    });
    if (res.files) results = results.concat(res.files);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return results;
}

function listSubfolders(folderId) {
  var results = [];
  var pageToken = null;
  do {
    var res = Drive.Files.list({
      q:                        "'" + folderId + "' in parents and trashed=false and mimeType = 'application/vnd.google-apps.folder'",
      fields:                   'nextPageToken,files(id,name)',
      pageSize:                 1000,
      includeItemsFromAllDrives: true,
      supportsAllDrives:        true,
      corpora:                  'allDrives',
      pageToken:                pageToken
    });
    if (res.files) results = results.concat(res.files);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return results;
}

function syncSoundVault() {
  var props         = PropertiesService.getScriptProperties();
  var INGEST_SECRET = props.getProperty('INGEST_SECRET');
  var INGEST_URL    = props.getProperty('INGEST_URL');
  var FOLDER_ID     = props.getProperty('FOLDER_ID');

  if (!INGEST_SECRET || !INGEST_URL || !FOLDER_ID) {
    throw new Error('Missing Script Properties: INGEST_SECRET, INGEST_URL, FOLDER_ID');
  }

  Logger.log('Config OK. Scanning folder: ' + FOLDER_ID);

  var files = [];

  // Files directly in root → Uncategorized
  var rootFiles = listFiles(FOLDER_ID);
  rootFiles.forEach(function(f) {
    if (AUDIO_EXTENSIONS.indexOf(getExtension(f.name)) === -1) return;
    files.push({
      id:           f.id,
      name:         f.name,
      category:     'Uncategorized',
      webViewLink:  f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view'),
      size:         f.size ? parseInt(f.size) : null,
      modifiedTime: f.modifiedTime || null
    });
  });

  // Files in subfolders → category = subfolder name
  var subfolders = listSubfolders(FOLDER_ID);
  Logger.log('Subfolders found: ' + subfolders.length);

  subfolders.forEach(function(folder) {
    var folderFiles = listFiles(folder.id);
    Logger.log('Subfolder "' + folder.name + '": ' + folderFiles.length + ' files');
    folderFiles.forEach(function(f) {
      if (AUDIO_EXTENSIONS.indexOf(getExtension(f.name)) === -1) return;
      files.push({
        id:           f.id,
        name:         f.name,
        category:     folder.name,
        webViewLink:  f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view'),
        size:         f.size ? parseInt(f.size) : null,
        modifiedTime: f.modifiedTime || null
      });
    });
  });

  Logger.log('Audio files found: ' + files.length);
  if (files.length === 0) {
    Logger.log('Nothing to ingest — check FOLDER_ID and folder structure.');
    return;
  }
  Logger.log('Sample: ' + JSON.stringify(files[0]));

  Logger.log('Posting to: ' + INGEST_URL);
  var response = UrlFetchApp.fetch(INGEST_URL, {
    method:             'post',
    contentType:        'application/json',
    headers:            { 'Authorization': 'Bearer ' + INGEST_SECRET },
    payload:            JSON.stringify({ files: files }),
    muteHttpExceptions: true,
    followRedirects:    false
  });

  Logger.log('Status: ' + response.getResponseCode());
  Logger.log('Response: ' + response.getContentText());

  if (response.getResponseCode() !== 200) {
    throw new Error('Ingest failed (' + response.getResponseCode() + '): ' + response.getContentText());
  }
}
