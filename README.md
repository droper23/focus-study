# Focus Study

Focus Study is a dedicated productivity environment designed for deep work and concentration. It combines essential focus tools into a single, minimal interface to help you stay on task and track your progress without the distractions of the open web.

## Core Features

### Deep Work Environment
Focus Study provides a controlled space for your work. When used as a desktop application, it utilizes an embedded Chromium engine with session-level request filtering to enforce your focus rules across all web navigation.

### Task Management and Selection
Stay organized with a built-in task list. For moments of indecision, the interactive Task Wheel can randomly select your next objective, helping you overcome analysis paralysis and start working immediately.

### Integrated Pomodoro Timer
Manage your energy levels using the integrated Pomodoro timer. Customize your work and break intervals (Short and Long breaks) to find the rhythm that best supports your productivity.

### Ambient Sound Generator
Create an optimal acoustic environment with built-in ambient noise. Choose between White, Pink, and Brown noise to mask background distractions and stay in the zone.

### Personal Analytics
Monitor your focus habits with local statistics. Track your total focus time, session averages, daily streaks, and session history to visualize your growth over time.

### Privacy and Portability
Your data is yours. Focus Study is designed as a local-first application. All task lists, settings, and focus statistics are stored directly on your computer. There is no cloud synchronization or external data tracking.

## Usage Options

### Desktop Application
The desktop version offers the most robust focus features, including the full Chromium webview engine and enhanced blocking capabilities.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the application:
   ```bash
   npm start
   ```

### Web Interface
Focus Study can also run as a static site in any modern web browser.

1. Start a local server:
   ```bash
   python3 -m http.server 8080
   ```
2. Navigate to `http://localhost:8080`.

## Building Distributions
To create native installers for macOS, Windows, or Linux:

```bash
npm run dist
```

Installers will be generated in the `release/` directory.
