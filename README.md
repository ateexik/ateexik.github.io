# 🚕 FakeTaxi Kučera

Rezervácia miest v aute na ranné jazdy do školy. Karol šoféruje, vojdú sa 4 a kto skôr klikne, ten ide.

## Čo to vie

- **Auto zhora**: klikneš na voľné sedadlo a je tvoje. Vpredu, vzadu vľavo, v strede, vpravo.
- **5 školských dní dopredu** (víkendy preskočí). Pri každom dni vidno, koľko miest ešte ostáva.
- **Naživo pre všetkých**: keď si niekto sadne, ostatní to hneď vidia. Keď dvaja kliknú na to isté miesto naraz, dostane ho len jeden.
- **Poradovník**: keď je auto plné, zapíšeš sa do radu. Keď sa niekto odhlási, prvý v rade dostane miesto automaticky.
- **Zamknutie o odchode**: o 7:20 (dá sa zmeniť) sa rezervácie na daný deň zamknú.
- **Režim šoféra** (s PIN-om): Karol môže zrušiť jazdu („v tento deň nejdem“), nechať odkaz („dnes o 7:10 pred bránou“), posadiť niekoho bez mobilu alebo niekoho vyhodiť.
- **📤 Poslať**: skopíruje zoznam na daný deň, aby si ho mohol hodiť do skupiny.
- **🏆 Rebríček**: kto sa za posledných 30 dní odviezol najviac.

Meno sa pamätá v telefóne. Svoje miesto môžeš zrušiť len z telefónu, z ktorého si ho zabral, takže ťa kamoši nemôžu len tak vyhodiť. To môže iba šofér.

## Súbory

| Súbor | Čo to je |
| --- | --- |
| `index.html`, `style.css`, `app.js` | samotná stránka |
| `config.js` | **nastavenia** (šofér, počet miest, čas odchodu, PIN, Firebase) |
| `database.rules.json` | pravidlá pre Firebase databázu |

## 1. Zverejnenie cez GitHub Pages

Repo sa volá `ateexik.github.io`, takže stránka pobeží na **https://ateexik.github.io**.

1. Zmerguj túto vetvu do `main` (alebo si ju na GitHube premenuj na `main`).
2. Na GitHube: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, vyber `main` a priečinok `/ (root)`, potom **Save**.
3. O minútu-dve je stránka online.

Bez ďalšieho nastavovania beží v **demo režime**: všetko funguje, ale rezervácie sa ukladajú iba v tvojom prehliadači, takže ich ostatní nevidia. Aby to bolo spoločné, sprav krok 2.

## 2. Spoločná databáza (Firebase, zadarmo, asi 5 minút)

1. Choď na <https://console.firebase.google.com> a prihlás sa Google účtom.
2. **Create a project**, názov napr. `faketaxi-kucera`. Google Analytics netreba.
3. V ľavom menu **Build → Realtime Database → Create Database**.
   - Lokalita: **Belgium (europe-west1)**
   - Režim: **Start in locked mode**
4. Hore prepni na záložku **Rules**, všetko tam zmaž, vlož celý obsah súboru `database.rules.json` a daj **Publish**.
5. Klikni na ⚙️ vedľa **Project Overview → Project settings**. Dole v časti **Your apps** klikni na ikonu webu **`</>`**, zadaj prezývku (napr. `faketaxi`) a daj **Register app**. Firebase Hosting netreba.
6. Ukáže sa ti `firebaseConfig`. Skopíruj ho do `config.js` namiesto `firebase: null`:

   ```js
   firebase: {
     apiKey: "AIza...",
     authDomain: "faketaxi-kucera.firebaseapp.com",
     databaseURL: "https://faketaxi-kucera-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "faketaxi-kucera",
     storageBucket: "faketaxi-kucera.firebasestorage.app",
     messagingSenderId: "...",
     appId: "...",
   },
   ```

   Hlavne skontroluj, že je tam **`databaseURL`**. Ak chýba, skopíruj ju z hornej časti stránky Realtime Database (záložka Data).
7. Commitni a pushni. Hotovo, pošli chalanom odkaz.

Bezplatný Firebase plán (Spark) stačí s veľkou rezervou: 100 ľudí naraz, 1 GB dát. Vy minete pár kilobajtov.

## 3. Nastavenia v `config.js`

```js
driver: "Karol",     // meno šoféra
seats: 4,            // počet pasažierov (bez šoféra)
departure: "07:20",  // čas odchodu, vtedy sa rezervácie zamknú
daysAhead: 5,        // na koľko školských dní dopredu
```

### Zmena PIN-u šoféra

Predvolený PIN je **1234**, takže ho hneď zmeň. Do `config.js` sa neukladá samotný PIN, ale jeho SHA-256 odtlačok:

- V prehliadači otvor konzolu (F12 → Console) a spusti (namiesto `9876` daj svoj PIN):

  ```js
  crypto.subtle.digest("SHA-256", new TextEncoder().encode("9876")).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("")))
  ```

- alebo v termináli: `echo -n 9876 | sha256sum`

Výsledok vlož do `driverPinHash`.

## Úprimne o bezpečnosti

Je to appka pre partiu kamošov, nie pre banku. Databázové pravidlá pustia len správne tvarované rezervácie, ale kto by sa vyznal a veľmi chcel, vie do databázy zapisovať aj mimo stránky. PIN šoféra iba schová panel. Ukladajú sa len mená (prezývky). Odkaz preto nedávaj verejne na internet, stačí ho poslať do skupiny.
