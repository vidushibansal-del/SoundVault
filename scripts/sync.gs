// SoundVault — Google Apps Script sync
// Paste this at script.google.com, set Script Properties, add a daily trigger.
//
// Script Properties required (Project Settings → Script Properties):
//   INGEST_SECRET  — must match INGEST_SECRET in Vercel env vars
//   INGEST_URL     — your Vercel deployment URL, e.g. https://soundvault.vercel.app/api/ingest

var AUDIO_EXTENSIONS = ['.wav', '.mp3', '.aiff', '.flac', '.ogg'];

function getExtension(name) {
  if (!name) return '';
  var idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.substring(idx).toLowerCase();
}

function syncSoundVault() {
  var props = PropertiesService.getScriptProperties();
  var INGEST_SECRET = props.getProperty('INGEST_SECRET');
  var INGEST_URL    = props.getProperty('INGEST_URL');
  var FOLDER_ID     = props.getProperty('FOLDER_ID');

  if (!INGEST_SECRET || !INGEST_URL || !FOLDER_ID) {
    throw new Error('Missing Script Properties: INGEST_SECRET, INGEST_URL, FOLDER_ID');
  }

  var rootFolder = DriveApp.getFolderById(FOLDER_ID);
  var files = [];

  // Files directly in root folder → Uncategorized
  var rootFiles = rootFolder.getFiles();
  while (rootFiles.hasNext()) {
    var f = rootFiles.next();
    if (AUDIO_EXTENSIONS.indexOf(getExtension(f.getName())) === -1) continue;
    files.push({
      id:           f.getId(),
      name:         f.getName(),
      category:     'Uncategorized',
      webViewLink:  f.getUrl(),
      size:         f.getSize(),
      modifiedTime: f.getLastUpdated().toISOString()
    });
  }

  // Files in subfolders → category = subfolder name
  var subfolders = rootFolder.getFolders();
  while (subfolders.hasNext()) {
    var folder = subfolders.next();
    var category = folder.getName();
    var folderFiles = folder.getFiles();
    while (folderFiles.hasNext()) {
      var f = folderFiles.next();
      if (AUDIO_EXTENSIONS.indexOf(getExtension(f.getName())) === -1) continue;
      files.push({
        id:           f.getId(),
        name:         f.getName(),
        category:     category,
        webViewLink:  f.getUrl(),
        size:         f.getSize(),
        modifiedTime: f.getLastUpdated().toISOString()
      });
    }
  }

  var response = UrlFetchApp.fetch(INGEST_URL, {
    method:      'post',
    contentType: 'application/json',
    headers:     { 'Authorization': 'Bearer ' + INGEST_SECRET },
    payload:     JSON.stringify({ files: files }),
    muteHttpExceptions: true
  });

  Logger.log('Status: ' + response.getResponseCode());
  Logger.log('Response: ' + response.getContentText());

  if (response.getResponseCode() !== 200) {
    throw new Error('Ingest failed: ' + response.getContentText());
  }
}
