// ⚙️ Nastavenia FakeTaxi Kučera — všetko podstatné sa mení tu.
window.FAKETAXI_CONFIG = {
  // Kto šoféruje
  driver: "Karol",

  // Koľko pasažierov sa zmestí (bez šoféra)
  seats: 4,

  // Kedy auto ráno odchádza. V tomto čase sa rezervácie na daný deň zamknú.
  departure: "07:20",

  // Na koľko školských dní dopredu sa dá rezervovať
  daysAhead: 5,

  // SHA-256 hash PIN-u pre režim šoféra. Predvolený PIN je 1234 — ZMEŇ HO (návod v README).
  driverPinHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",

  // Spoločná databáza (Firebase Realtime Database).
  // Kým je tu null, stránka beží v demo režime a rezervácie vidíš iba ty vo svojom prehliadači.
  // Návod, čo sem vložiť, je v README v časti „Spoločná databáza“.
  firebase: null,
};
