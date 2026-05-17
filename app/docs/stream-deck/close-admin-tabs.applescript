set targetUrls to {"http://127.0.0.1:3310/admin", "http://localhost:3310/admin"}

on urlMatches(targetUrl, targetUrls)
	repeat with candidateUrl in targetUrls
		if targetUrl starts with candidateUrl then return true
	end repeat
	return false
end urlMatches

on closeSafariTabs(targetUrls)
	with timeout of 2 seconds
		tell application "System Events"
			if not (exists process "Safari") then return
		end tell
	end timeout

	with timeout of 3 seconds
		tell application "Safari"
			repeat with w in windows
				repeat with t in tabs of w
					try
						if my urlMatches(URL of t, targetUrls) then close t
					end try
				end repeat
			end repeat
		end tell
	end timeout
end closeSafariTabs

on closeChromiumTabs(appName, targetUrls)
	with timeout of 2 seconds
		tell application "System Events"
			if not (exists process appName) then return
		end tell
	end timeout

	with timeout of 3 seconds
		tell application appName
			repeat with w in windows
				repeat with t in tabs of w
					try
						if my urlMatches(URL of t, targetUrls) then close t
					end try
				end repeat
			end repeat
		end tell
	end timeout
end closeChromiumTabs

try
	closeSafariTabs(targetUrls)
end try

try
	closeChromiumTabs("Google Chrome", targetUrls)
end try

try
	closeChromiumTabs("Brave Browser", targetUrls)
end try

try
	closeChromiumTabs("Arc", targetUrls)
end try
