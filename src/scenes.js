// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Read a repository": the figures of a followed repository as outputs, for
// the next actions of the scene (a message with the number of open issues, a
// condition on the CI). Read again when the last reading is older than a
// minute; read-only, like the whole integration.
// -----------------------------------------------------------------------------

import { shownRelease } from './devices.js';
import { CI_STATES } from './forge/client.js';
import { CI_TEXT, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async get_repository(hub, { fields = {} }) {
    const language = hub.config.language;
    const { repo, releases, ci } = await hub.entryOf(fields.repository, language);
    const release = releases ? shownRelease(releases) : null;
    return {
      repository_name: repo.fullName,
      url: repo.url,
      stars: repo.stars,
      forks: repo.forks,
      open_issues: repo.openIssues,
      open_pull_requests: repo.openPulls,
      latest_release: release?.tag ?? '',
      ci_status: pick(CI_TEXT[ci?.state ?? CI_STATES.NONE], language),
      ci_passing: ci?.state === CI_STATES.SUCCESS,
    };
  },
};
