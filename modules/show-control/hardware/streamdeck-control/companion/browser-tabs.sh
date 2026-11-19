#!/bin/zsh
set -euo pipefail

MODE="${1:-}"
TARGET_URL="${2:-}"
LOG_PATH="${FORYOU_BROWSER_TABS_LOG:-$HOME/Library/Logs/ForYouApp/streamdeck-browser-tabs.log}"

mkdir -p "$(dirname "$LOG_PATH")"

usage() {
  echo "Gebruik: $0 open-or-focus <url> | close-url <url> | close-all | zaalscherm-vrij [proef]" >&2
  exit 64
}


# Het zaalscherm (HDMI-splitter naar de tv's) is alleen voor TouchDesigner.
# Een browservenster dat daar staat of opent, gaat terug naar het hoofdscherm.
# Tweede argument "proef" meldt alleen wat er zou gebeuren.
zaalscherm_vrij() {
  /usr/bin/osascript -l JavaScript - "${1:-}" 2>>"$LOG_PATH" <<'JXA' || true
ObjC.import("AppKit");
ObjC.import("stdlib");
function run(argv) {
  var proef = argv[0] === "proef";
  var extra = "";
  try { extra = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey("FORYOU_ZAALSCHERM_NAAM")) || ""; } catch (e) {}
  var screens = $.NSScreen.screens;
  var hoofd = screens.objectAtIndex(0).frame;
  var H = hoofd.size.height;
  var zaal = [];
  for (var i = 1; i < screens.count; i++) {
    var s = screens.objectAtIndex(i), f = s.frame, naam = ObjC.unwrap(s.localizedName);
    var w = f.size.width, h = f.size.height;
    var tv = /HDMI|SPLITTER|LG/i.test(naam) || (w === 1920 && h === 1080) || (w === 3840 && h === 2160);
    if (extra) tv = naam === extra;
    if (tv) zaal.push({ naam: naam, x: f.origin.x, y: H - (f.origin.y + h), w: w, h: h });
  }
  var uit = [];
  if (!zaal.length) return "zaalscherm|geen";
  var apps = ["Brave Browser", "Google Chrome", "Microsoft Edge", "Arc", "Safari"];
  apps.forEach(function (naam) {
    var app;
    try { app = Application(naam); if (!app.running()) return; } catch (e) { return; }
    var wins;
    try { wins = app.windows(); } catch (e) { return; }
    wins.forEach(function (win) {
      try {
        var b = win.bounds();
        var raakt = zaal.some(function (z) {
          return b.x < z.x + z.w && b.x + b.width > z.x && b.y < z.y + z.h && b.y + b.height > z.y;
        });
        if (!raakt) return;
        var nieuw = { x: 80, y: 60, width: Math.min(b.width, hoofd.size.width - 160), height: Math.min(b.height, H - 120) };
        if (!proef) win.bounds = nieuw;
        uit.push((proef ? "zou_verplaatsen|" : "verplaatst|") + naam + "|" + b.x + "," + b.y + "," + b.width + "," + b.height);
      } catch (e) {}
    });
  });
  return uit.length ? uit.join("\n") : "zaalscherm|vrij";
}
JXA
}

if [[ "$MODE" == "zaalscherm-vrij" ]]; then
  zaalscherm_vrij "$TARGET_URL" | tee -a "$LOG_PATH"
  exit 0
fi

if [[ "$MODE" != "open-or-focus" && "$MODE" != "close-url" && "$MODE" != "close-all" ]]; then
  usage
fi

if [[ ("$MODE" == "open-or-focus" || "$MODE" == "close-url") && -z "$TARGET_URL" ]]; then
  usage
fi

if ! result="$(
  /usr/bin/osascript - "$MODE" "$TARGET_URL" 2>>"$LOG_PATH" <<'APPLESCRIPT'
on run argv
	set modeName to item 1 of argv
	set targetUrl to ""
	if (count of argv) > 1 then set targetUrl to item 2 of argv

	if modeName is "open-or-focus" then
		if my focusExistingTab(targetUrl) then return "focused"
		return "missing"
	end if

	if modeName is "close-all" then
		set closedCount to my closeForYouTabs()
		return "closed|" & closedCount
	end if

	if modeName is "close-url" then
		set closedCount to my closeTabsForUrl(targetUrl)
		return "closed|" & closedCount
	end if

	return "unknown_mode"
end run

on suffixAfterPrefix(theText, prefixText)
	set textLength to length of theText
	set prefixLength to length of prefixText
	if textLength <= prefixLength then return ""
	return text (prefixLength + 1) thru -1 of theText
end suffixAfterPrefix

on pathWithoutQuery(thePath)
	set pathText to thePath as text
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "?"
	set beforeQuery to text item 1 of pathText
	set AppleScript's text item delimiters to "#"
	set beforeHash to text item 1 of beforeQuery
	set AppleScript's text item delimiters to previousDelimiters
	if beforeHash is "" then return "/"
	return beforeHash
end pathWithoutQuery

on stripTrailingSlash(thePath)
	if thePath is "/" then return thePath
	if thePath ends with "/" then return text 1 thru -2 of thePath
	return thePath
end stripTrailingSlash

on pathForPort(theUrl, portText)
	set rawUrl to theUrl as text
	set localPrefixes to {"http://127.0.0.1:" & portText, "http://localhost:" & portText, "http://0.0.0.0:" & portText, "http://[::1]:" & portText}
	repeat with prefixText in localPrefixes
		set prefixValue to prefixText as text
		if rawUrl starts with prefixValue then
			set remainder to my suffixAfterPrefix(rawUrl, prefixValue)
			if remainder is "" then return "/"
			return my stripTrailingSlash(my pathWithoutQuery(remainder))
		end if
	end repeat

	set marker to ":" & portText
	if rawUrl does not contain marker then return ""
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to marker
	set markerParts to text items of rawUrl
	set AppleScript's text item delimiters to previousDelimiters
	if (count of markerParts) < 2 then return ""
	set remainder to item 2 of markerParts
	if remainder is "" then return "/"
	return my stripTrailingSlash(my pathWithoutQuery(remainder))
end pathForPort

on routeKeyForMatch(theUrl)
		set forYouPorts to {"3020", "3021", "3022", "3023", "3024", "3025", "3026", "3027", "3225", "3226", "3227", "3228", "3229", "3310", "3105"}
	repeat with portText in forYouPorts
		set portValue to portText as text
		set routePath to my pathForPort(theUrl, portValue)
		if routePath is not "" then return portValue & ":" & routePath
	end repeat
	return ""
end routeKeyForMatch

on urlsMatch(currentUrl, targetUrl)
	set currentKey to my routeKeyForMatch(currentUrl)
	set targetKey to my routeKeyForMatch(targetUrl)
	if currentKey is "" or targetKey is "" then return false
	return currentKey is targetKey
end urlsMatch

on isForYouLink(currentUrl)
	return my routeKeyForMatch(currentUrl) is not ""
end isForYouLink

on appIsRunning(appName)
	try
		return application appName is running
	end try
	return false
end appIsRunning

on setChromiumActiveTabIndex(appName, windowIndex, tabIndex)
	run script "tell application \"" & appName & "\" to set active tab index of window " & windowIndex & " to " & tabIndex
end setChromiumActiveTabIndex

on activateChromiumWindow(appName, windowIndex)
	run script "tell application \"" & appName & "\" to set index of window " & windowIndex & " to 1"
	run script "tell application \"" & appName & "\" to activate"
end activateChromiumWindow

on chromiumWindowCount(appName)
	return run script "tell application \"" & appName & "\" to count of windows"
end chromiumWindowCount

on chromiumTabCount(appName, windowIndex)
	return run script "tell application \"" & appName & "\" to count of tabs of window " & windowIndex
end chromiumTabCount

on chromiumTabUrl(appName, windowIndex, tabIndex)
	return run script "tell application \"" & appName & "\" to get URL of tab " & tabIndex & " of window " & windowIndex
end chromiumTabUrl

on closeChromiumTab(appName, windowIndex, tabIndex)
	run script "tell application \"" & appName & "\" to close tab " & tabIndex & " of window " & windowIndex
end closeChromiumTab

on focusSafariTab(targetUrl)
	if not my appIsRunning("Safari") then return false
	with timeout of 8 seconds
		tell application "Safari"
			repeat with windowIndex from 1 to count of windows
				set browserWindow to window windowIndex
				repeat with tabIndex from 1 to count of tabs of browserWindow
					set browserTab to item tabIndex of tabs of browserWindow
					try
						if my urlsMatch(URL of browserTab, targetUrl) then
							set |current tab| of browserWindow to browserTab
							set index of browserWindow to 1
							activate
							return true
						end if
					end try
				end repeat
			end repeat
		end tell
	end timeout
	return false
end focusSafariTab

on focusChromiumTab(appName, targetUrl)
	if not my appIsRunning(appName) then return false
	with timeout of 8 seconds
		set windowCount to my chromiumWindowCount(appName)
		repeat with windowIndex from 1 to windowCount
			set tabCount to my chromiumTabCount(appName, windowIndex)
			repeat with tabIndex from 1 to tabCount
				try
					if my urlsMatch(my chromiumTabUrl(appName, windowIndex, tabIndex), targetUrl) then
						try
							my setChromiumActiveTabIndex(appName, windowIndex, tabIndex)
						end try
						my activateChromiumWindow(appName, windowIndex)
						return true
					end if
				end try
			end repeat
		end repeat
	end timeout
	return false
end focusChromiumTab

on focusExistingTab(targetUrl)
	try
		if my focusChromiumTab("Brave Browser", targetUrl) then return true
	end try
	try
		if my focusChromiumTab("Google Chrome", targetUrl) then return true
	end try
	try
		if my focusChromiumTab("Microsoft Edge", targetUrl) then return true
	end try
	try
		if my focusChromiumTab("Arc", targetUrl) then return true
	end try
	try
		if my focusSafariTab(targetUrl) then return true
	end try
	return false
end focusExistingTab

on closeSafariTabs()
	set closedCount to 0
	if not my appIsRunning("Safari") then return closedCount
	with timeout of 8 seconds
		tell application "Safari"
			repeat with windowIndex from (count of windows) to 1 by -1
				set browserWindow to window windowIndex
				repeat with tabIndex from (count of tabs of browserWindow) to 1 by -1
					try
						set browserTab to item tabIndex of tabs of browserWindow
						if my isForYouLink(URL of browserTab) then
							close browserTab
							set closedCount to closedCount + 1
						end if
					end try
				end repeat
			end repeat
		end tell
	end timeout
	return closedCount
end closeSafariTabs

on closeChromiumTabs(appName)
	set closedCount to 0
	if not my appIsRunning(appName) then return closedCount
	with timeout of 8 seconds
		set windowCount to my chromiumWindowCount(appName)
		repeat with windowIndex from windowCount to 1 by -1
			set tabCount to my chromiumTabCount(appName, windowIndex)
			repeat with tabIndex from tabCount to 1 by -1
				try
					if my isForYouLink(my chromiumTabUrl(appName, windowIndex, tabIndex)) then
						my closeChromiumTab(appName, windowIndex, tabIndex)
						set closedCount to closedCount + 1
					end if
				end try
			end repeat
		end repeat
	end timeout
	return closedCount
end closeChromiumTabs

on closeForYouTabs()
	set closedCount to 0
	try
		set closedCount to closedCount + my closeChromiumTabs("Brave Browser")
	end try
	try
		set closedCount to closedCount + my closeChromiumTabs("Google Chrome")
	end try
	try
		set closedCount to closedCount + my closeChromiumTabs("Microsoft Edge")
	end try
	try
		set closedCount to closedCount + my closeChromiumTabs("Arc")
	end try
	try
		set closedCount to closedCount + my closeSafariTabs()
	end try
	return closedCount
end closeForYouTabs

on closeTabsForUrl(targetUrl)
	set closedCount to 0
	try
		set closedCount to closedCount + my closeChromiumTabsForUrl("Brave Browser", targetUrl)
	end try
	try
		set closedCount to closedCount + my closeChromiumTabsForUrl("Google Chrome", targetUrl)
	end try
	try
		set closedCount to closedCount + my closeChromiumTabsForUrl("Microsoft Edge", targetUrl)
	end try
	try
		set closedCount to closedCount + my closeChromiumTabsForUrl("Arc", targetUrl)
	end try
	try
		set closedCount to closedCount + my closeSafariTabsForUrl(targetUrl)
	end try
	return closedCount
end closeTabsForUrl

on closeSafariTabsForUrl(targetUrl)
	set closedCount to 0
	if not my appIsRunning("Safari") then return closedCount
	with timeout of 8 seconds
		tell application "Safari"
			repeat with windowIndex from (count of windows) to 1 by -1
				set browserWindow to window windowIndex
				repeat with tabIndex from (count of tabs of browserWindow) to 1 by -1
					try
						set browserTab to item tabIndex of tabs of browserWindow
						if my urlsMatch(URL of browserTab, targetUrl) then
							close browserTab
							set closedCount to closedCount + 1
						end if
					end try
				end repeat
			end repeat
		end tell
	end timeout
	return closedCount
end closeSafariTabsForUrl

on closeChromiumTabsForUrl(appName, targetUrl)
	set closedCount to 0
	if not my appIsRunning(appName) then return closedCount
	with timeout of 8 seconds
		set windowCount to my chromiumWindowCount(appName)
		repeat with windowIndex from windowCount to 1 by -1
			set tabCount to my chromiumTabCount(appName, windowIndex)
			repeat with tabIndex from tabCount to 1 by -1
				try
					if my urlsMatch(my chromiumTabUrl(appName, windowIndex, tabIndex), targetUrl) then
						my closeChromiumTab(appName, windowIndex, tabIndex)
						set closedCount to closedCount + 1
					end if
				end try
			end repeat
		end repeat
	end timeout
	return closedCount
end closeChromiumTabsForUrl
APPLESCRIPT
)"; then
  printf 'osascript_error|%s|%s\n' "$MODE" "$TARGET_URL" >>"$LOG_PATH"
  if [[ "$MODE" == "open-or-focus" ]]; then
    result="missing"
  else
    result="closed|0"
  fi
fi

printf '%s\n' "$result" >>"$LOG_PATH"

if [[ "$MODE" == "open-or-focus" && "$result" == "missing" ]]; then
  /usr/bin/open "$TARGET_URL"
  printf 'opened|%s\n' "$TARGET_URL" | tee -a "$LOG_PATH"
  # Een nieuw venster verschijnt soms pas na een moment: een paar keer nakijken.
  ( for _ in 1 2 3 4 5 6; do sleep 0.5; zaalscherm_vrij; done >>"$LOG_PATH" 2>&1 & ) >/dev/null 2>&1
  exit 0
fi

if [[ "$MODE" == "open-or-focus" ]]; then
  zaalscherm_vrij >>"$LOG_PATH" 2>&1
fi

printf '%s\n' "$result"
