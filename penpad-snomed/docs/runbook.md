# Runbook
Owner: Gunnar Nordqvist. Deputy: none (gap). Tier A demo: no patient data may be entered.

**Watch.** Actions tab of gunnarnordqvist/Hack; live version at https://gunnarnordqvist.github.io/Hack/version.json (shows the commit). Open the page and click "Run the examples" equivalents: type a sample sentence and see candidates.

**Stop / switch off.** Settings → Pages → unpublish, or disable the workflow in the Actions tab. If the terminology server is down the page shows an error in the candidate list; nothing else breaks.

**Roll back.** `git revert <bad commit>` on main and push (the pipeline redeploys); or re-run the workflow of an earlier good commit. gh-pages can be reset to an earlier commit. *Not yet performed by anyone other than the assistant.*

**If someone typed personal data.** The guard blocks identity numbers and e-mails from being sent; other free text reaches the terminology server as search words only. Nothing is stored by us.

**First hour of an incident.** 1) switch the page off 2) note time and what was seen 3) check Actions log and tx server status 4) revert 5) tell the owner.

**Sunset.** No date set (gap). Proposal: remove the site after the hackathon follow-up, 2026-12-31, unless the owner extends.
