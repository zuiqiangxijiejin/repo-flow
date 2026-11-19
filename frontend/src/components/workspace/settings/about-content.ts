import { PROJECT_REPOSITORY_URL } from "@/core/product";
import { APP_VERSION } from "@/version";

export const aboutMarkdown = `# About RepoFlow ${APP_VERSION}

RepoFlow brings repository conversations, code changes, regression checks and Git review into one workspace.

Connect your own GitHub account, associate a repository, review changes and push a contribution branch to your fork. Save PR information locally before choosing to create a GitHub draft or a ready-for-review PR.

Optional tools, skills and extensions are available in Settings → Optional features. Available actions follow your account permissions and the server configuration.

[Project repository](${PROJECT_REPOSITORY_URL}) · [Documentation](${PROJECT_REPOSITORY_URL}/tree/main/docs)

Distributed under the MIT License. See the repository LICENSE and bundled third-party notices for copyright and license terms.
`;
