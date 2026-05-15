// SoundVault — Google Apps Script sync
// Script Properties required (Project Settings → Script Properties):
//   INGEST_SECRET  — must match INGEST_SECRET in Vercel env vars
//   INGEST_URL     — https://your-app.vercel.app/api/ingest
//   FOLDER_ID      — Google Drive folder ID from the URL

var AUDIO_EXTENSIONS = ['.wav', '.mp3', '.aiff', '.flac', '.ogg'];

function getExtension(name) {
  if (!name) return '';
  var idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.substring(idx).toLowerCase();
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

  var rootFolder = DriveApp.getFolderById(FOLDER_ID);
  var files = [];

  // Files directly in root → Uncategorized
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
    var folder     = subfolders.next();
    var category   = folder.getName();
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

  Logger.log('Audio files found: ' + files.length);
  if (files.length === 0) {
    Logger.log('Nothing to ingest — check FOLDER_ID and folder structure.');
    return;
  }
  Logger.log('Sample: ' + JSON.stringify(files[0]));

  var response = UrlFetchApp.fetch(INGEST_URL, {
    method:             'post',
    contentType:        'application/json',
    headers:            { 'Authorization': 'Bearer ' + INGEST_SECRET },
    payload:            JSON.stringify({ files: files }),
    muteHttpExceptions: true
  });

  Logger.log('Status: ' + response.getResponseCode());
  Logger.log('Response: ' + response.getContentText());

  if (response.getResponseCode() !== 200) {
    throw new Error('Ingest failed (' + response.getResponseCode() + '): ' + response.getContentText());
  }
}
