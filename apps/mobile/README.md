# VÉLORA mobile

The VÉLORA shopping app for Android and iOS, built with Expo SDK 54 (React Native 0.81, Expo Router). It uses the same `/api/v1` backend as the website.

## What's in the app

- **Shopping:** the home feed, departments, search, category and sale pages.
  - The home feed has the live flash sale with its countdown, new arrivals, "Picked for you" and best sellers.
  - Search suggests as you type, including "did you mean" corrections.
  - Category and sale pages scroll endlessly and can be sorted and filtered.
- **Product pages:** a swipeable gallery, colour and size selection, stock and sale-price messages, delivery times, and related products.
- **Bag and checkout:**
  - Guests keep a bag between visits, and it moves into their account when they sign in.
  - Promo codes, saved or new addresses, delivery options, and rewards points.
  - Cash or MoMo on delivery. Online payments open the provider's secure page in an in-app browser; card details and MoMo PINs never touch the app.
- **Account:** orders (track, cancel, pay for unpaid orders), rewards (tier, history, sharing a referral link), the wishlist, and notification settings for app, email and SMS.
- **Push notifications:** order updates and other account notifications arrive on the phone, and tapping one opens the related screen. Customers can turn push off per message type.

## Security

- Sign-in uses the mobile mode of the API: the client sends `X-Velora-Client: mobile`.
- The refresh token is stored in the device keychain or keystore (`expo-secure-store`). The short-lived access token is kept only in memory.
- Refresh tokens rotate on every use, and reusing an old one revokes the session.
- Signing out removes this phone's push token and revokes the session.
- Prices and totals always come from the server, as on the website.

## Running it

From the repository root (with the API running, see the main README):

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env   # set EXPO_PUBLIC_API_URL for your device
npm run dev:mobile                              # Expo dev server
```

- **In a browser:** press `w`, or run `npm run web -w @velora/mobile`. Add `http://localhost:8081` to the API's `CORS_ORIGINS` (already the case in the local `.env`).
- **Android emulator or a phone:** build a development client once with `npm run android -w @velora/mobile`, or `ios` on a Mac with Xcode. The project targets SDK 54 to share React 19.1 with the website, and the Expo Go app in the stores only runs the newest SDK.
- **A real phone:** set `EXPO_PUBLIC_API_URL` to your computer's LAN address, for example `http://192.168.1.20:4000/api/v1`.

## Push notifications in production

1. Create an Expo project with `npx eas init`. This fills `expo.extra.eas.projectId` in `app.json`; without it the app skips push registration.
2. Add FCM credentials for Android and an APNs key for iOS with `eas credentials`.
3. On the API, set `PUSH_DRIVER=expo`, plus `EXPO_ACCESS_TOKEN` if "enhanced push security" is turned on for the project.
4. Build with `eas build`. Push tokens are only available on real devices, not simulators or the web.

## Checks

```bash
npm run typecheck -w @velora/mobile
npx expo-doctor                       # from apps/mobile
npx expo export --platform web        # bundles every screen
```
