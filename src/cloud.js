/* Firebase backend: Google sign-in and Firestore. Gives the Store the same shape it already uses:
   use('db') -> doc(path).get / set / onSnapshot, use('user') -> id(). Does nothing until FIREBASE_CONFIG is filled in
   or when the Firebase scripts did not load (no network on first open, tests). */
(function () {
  'use strict';
  var FIREBASE_CONFIG = {   // Firebase console > Project settings > Your apps. Not a secret: access is enforced by firestore.rules.
    apiKey: 'AIzaSyBPNCuJaNFnIZdWdPdLdFQMPEiHh7JrgU4',
    authDomain: 'daily-planner-b1bd5.firebaseapp.com',
    projectId: 'daily-planner-b1bd5',
    storageBucket: 'daily-planner-b1bd5.firebasestorage.app',
    messagingSenderId: '398846991531',
    appId: '1:398846991531:web:c7fc216d3ddc7a3063ebee'
  };
  if (!FIREBASE_CONFIG || typeof firebase === 'undefined') return;
  firebase.initializeApp(FIREBASE_CONFIG);
  var auth = firebase.auth(), db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(function () { });   // offline cache; unavailable in some private modes
  var who = new Promise(function (res) { var off = auth.onAuthStateChanged(function (u) { off(); res(u); }); });
  window.plannerCloud = {
    use: async function (n) {
      if (n === 'db') return db;
      if (n === 'user') return { id: async function () { var u = await who; return u ? u.uid : null; } };
      throw new Error('not available');
    },
    // Popup, not redirect: the redirect flow fails in iOS Safari on domains other than firebaseapp.com.
    signIn: function () { return auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); },
    signOut: function () { return auth.signOut(); }
  };
})();
