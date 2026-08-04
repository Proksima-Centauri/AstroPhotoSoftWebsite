<?php
$httpsEnabled = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $httpsEnabled,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

const SESSION_LIFETIME_SECONDS = 300;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_BLOCK_SECONDS = 900;
const RATE_LIMIT_FILE = '/tmp/web_access_rate_limit.json';

function loadEnvFile(string $path): array
{
    $vars = [];
    if (!is_file($path)) {
        return $vars;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return $vars;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $parts = explode('=', $trimmed, 2);
        if (count($parts) !== 2) {
            continue;
        }

        $key = trim($parts[0]);
        $value = trim($parts[1]);
        $vars[$key] = trim($value, "\"'");
    }

    return $vars;
}

function getClientIp(): string
{
    $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '';
    return $remoteAddr !== '' ? $remoteAddr : 'unknown';
}

function loadRateLimitState(string $path): array
{
    if (!is_file($path)) {
        return [];
    }

    $json = file_get_contents($path);
    if ($json === false || $json === '') {
        return [];
    }

    $decoded = json_decode($json, true);
    return is_array($decoded) ? $decoded : [];
}

function saveRateLimitState(string $path, array $state): void
{
    file_put_contents($path, json_encode($state, JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function purgeRateLimitState(array $state, int $now): array
{
    foreach ($state as $ip => $entry) {
        $attempts = isset($entry['attempts']) && is_array($entry['attempts']) ? $entry['attempts'] : [];
        $lockedUntil = isset($entry['locked_until']) ? (int) $entry['locked_until'] : 0;
        $attempts = array_values(array_filter($attempts, static fn ($ts) => ($now - (int) $ts) < RATE_LIMIT_WINDOW_SECONDS));

        if (empty($attempts) && $lockedUntil <= $now) {
            unset($state[$ip]);
            continue;
        }

        $state[$ip] = [
            'attempts' => $attempts,
            'locked_until' => $lockedUntil,
        ];
    }

    return $state;
}

function getLockoutSeconds(array $state, string $ip, int $now): int
{
    $entry = $state[$ip] ?? null;
    if (!is_array($entry)) {
        return 0;
    }

    $lockedUntil = isset($entry['locked_until']) ? (int) $entry['locked_until'] : 0;
    if ($lockedUntil <= $now) {
        return 0;
    }

    return $lockedUntil - $now;
}

function registerFailedAttempt(array $state, string $ip, int $now): array
{
    $entry = $state[$ip] ?? ['attempts' => [], 'locked_until' => 0];
    $attempts = isset($entry['attempts']) && is_array($entry['attempts']) ? $entry['attempts'] : [];
    $attempts[] = $now;
    $attempts = array_values(array_filter($attempts, static fn ($ts) => ($now - (int) $ts) < RATE_LIMIT_WINDOW_SECONDS));

    $lockedUntil = isset($entry['locked_until']) ? (int) $entry['locked_until'] : 0;
    if (count($attempts) >= RATE_LIMIT_MAX_ATTEMPTS) {
        $lockedUntil = $now + RATE_LIMIT_BLOCK_SECONDS;
        $attempts = [];
    }

    $state[$ip] = [
        'attempts' => $attempts,
        'locked_until' => $lockedUntil,
    ];

    return $state;
}

function clearAttempts(array $state, string $ip): array
{
    unset($state[$ip]);
    return $state;
}

function verifyAccessKey(string $provided, string $hash, string $plain): bool
{
    if ($hash !== '') {
        return password_verify($provided, $hash);
    }

    if ($plain !== '') {
        return hash_equals($plain, $provided);
    }

    return false;
}

function ensureCsrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return (string) $_SESSION['csrf_token'];
}

function clearUnlockState(): void
{
    unset($_SESSION['site_unlocked'], $_SESSION['site_unlocked_at']);
}

$env = loadEnvFile(__DIR__ . '/.env');
$accessKey = $env['SITE_ACCESS_KEY'] ?? '';
$accessKeyHash = $env['SITE_ACCESS_KEY_HASH'] ?? '';
$isUnlocked = isset($_SESSION['site_unlocked']) && $_SESSION['site_unlocked'] === true;
$csrfToken = ensureCsrfToken();
$error = '';
$now = time();
$clientIp = getClientIp();
$rateLimitState = purgeRateLimitState(loadRateLimitState(RATE_LIMIT_FILE), $now);

if (isset($_GET['logout']) && $_GET['logout'] === '1') {
    clearUnlockState();
    session_regenerate_id(true);
    $isUnlocked = false;
    $error = 'Sesja zakonczona.';
}

if ($isUnlocked) {
    $unlockedAt = isset($_SESSION['site_unlocked_at']) ? (int) $_SESSION['site_unlocked_at'] : 0;
    if ($unlockedAt <= 0 || ($now - $unlockedAt) >= SESSION_LIFETIME_SECONDS) {
        clearUnlockState();
        session_regenerate_id(true);
        $isUnlocked = false;
        $error = 'Sesja wygasla po 5 minutach. Wpisz klucz ponownie.';
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['access_key'])) {
    $lockedFor = getLockoutSeconds($rateLimitState, $clientIp, $now);

    if ($lockedFor > 0) {
        $minutes = (int) ceil($lockedFor / 60);
        $error = 'Zbyt wiele prob. Sprobuj ponownie za okolo ' . $minutes . ' min.';
    } else {
        $postedCsrf = isset($_POST['csrf_token']) ? (string) $_POST['csrf_token'] : '';
        if ($postedCsrf === '' || !hash_equals($csrfToken, $postedCsrf)) {
            $error = 'Niepoprawne zadanie. Odswiez strone i sprobuj ponownie.';
        } else {
            $provided = trim((string) $_POST['access_key']);
            if (verifyAccessKey($provided, $accessKeyHash, $accessKey)) {
                session_regenerate_id(true);
                $_SESSION['site_unlocked'] = true;
                $_SESSION['site_unlocked_at'] = $now;
                $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
                $rateLimitState = clearAttempts($rateLimitState, $clientIp);
                saveRateLimitState(RATE_LIMIT_FILE, $rateLimitState);
                header('Location: /');
                exit;
            }

            $rateLimitState = registerFailedAttempt($rateLimitState, $clientIp, $now);
            saveRateLimitState(RATE_LIMIT_FILE, $rateLimitState);
            $error = 'Niepoprawny klucz.';
        }
    }
}

if ($accessKey === '' && $accessKeyHash === '') {
    http_response_code(500);
    echo 'Brak SITE_ACCESS_KEY lub SITE_ACCESS_KEY_HASH w pliku .env';
    exit;
}

saveRateLimitState(RATE_LIMIT_FILE, $rateLimitState);

if (!$isUnlocked) {
    ?>
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dostep zabezpieczony</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Arial, sans-serif;
      background: radial-gradient(circle at 20% 10%, #1f2d44 0%, #070b12 60%);
      color: #eef4ff;
    }
    .panel {
      width: min(420px, 92vw);
      background: rgba(10, 17, 30, 0.86);
      border: 1px solid rgba(238, 244, 255, 0.18);
      border-radius: 14px;
      padding: 24px;
    }
    h1 { margin: 0 0 10px; font-size: 1.3rem; }
    p { margin: 0 0 16px; color: rgba(238, 244, 255, 0.8); }
    input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(238, 244, 255, 0.25);
      background: rgba(0, 0, 0, 0.25);
      color: #eef4ff;
      margin-bottom: 12px;
    }
    button {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: none;
      background: #8ff2ff;
      color: #07101d;
      font-weight: 700;
      cursor: pointer;
    }
    .msg { margin-top: 10px; min-height: 20px; color: #ffb3b3; }
  </style>
</head>
<body>
  <main class="panel">
    <h1>Podaj klucz dostepu</h1>
    <p>Ta strona jest chroniona kluczem z pliku .env.</p>
    <form method="post" action="/">
      <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">
      <input name="access_key" type="password" autocomplete="off" placeholder="Klucz" required>
      <button type="submit">Odblokuj strone</button>
    </form>
    <div class="msg"><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div>
  </main>
</body>
</html>
    <?php
    exit;
}
?>
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AstroPhotoSoft</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <canvas id="space"></canvas>

  <nav class="topbar">
    <div class="logo">🌌 AstroPhotoSoft</div>
    <div class="links">
      <a href="#">Home</a>
      <a href="#">Aplikacje</a>
      <a href="#">Astro</a>
    </div>
    <a class="support" href="https://buycoffee.to/astrophotosoft" target="_blank" rel="noreferrer">☕ Wesprzyj</a>
  </nav>

  <header class="hero">
    <h1>Twoje centrum kosmosu</h1>
    <p>Astrofotografia • programowanie • projekty</p>
  </header>

  <main class="grid">
    <a class="card" href="apka1/index.html">
      🔭
      <h3>Astro Ai Pro</h3>
      <p>Wersja programu Astro Ai skierowana dla Profesjonalistow. Zawiera klasyczne funkcje obrobki Astro oraz obsluguje sztuczna inteligencje ulatwiajaca przetwarzanie.</p>
    </a>

    <a class="card" href="apka2/index.html">
      &lt;/&gt;
      <h3>Astro Script Editor</h3>
      <p>IDE dzialajace ze wszystkimi aplikacjami AstroPhotoSoft. Umozliwia automatyzacje przetwarzania.</p>
    </a>
  </main>

  <section class="about">
    <h2>O mnie</h2>
    <p>AstroPhotoSoft to moje centrum projektow technologicznych i astrofotografii.</p>
  </section>

  <script src="/space.js"></script>
  <script>
    setTimeout(() => {
      window.location.href = '/?logout=1';
    }, <?php echo SESSION_LIFETIME_SECONDS * 1000; ?>);
  </script>
</body>
</html>
