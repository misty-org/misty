-- OpenCode 2.3.0's chat tables (its own DDL), and one session it wrote with the free
-- opencode/big-pickle model: a tool turn, then a second prompt resumed by the session's id.
-- The scratch folder it ran in is replaced by /work.
CREATE TABLE `session_v2` (
          `id` text PRIMARY KEY,
          `project_id` text NOT NULL,
          `workspace_id` text,
          `parent_id` text,
          `fork_session_id` text,
          `fork_boundary` text,
          `slug` text NOT NULL,
          `directory` text NOT NULL,
          `path` text,
          `title` text,
          `version` text NOT NULL,
          `share_url` text,
          `summary_additions` integer,
          `summary_deletions` integer,
          `summary_files` integer,
          `summary_diffs` text,
          `metadata` text,
          `cost` real DEFAULT 0 NOT NULL,
          `tokens_input` integer DEFAULT 0 NOT NULL,
          `tokens_output` integer DEFAULT 0 NOT NULL,
          `tokens_reasoning` integer DEFAULT 0 NOT NULL,
          `tokens_cache_read` integer DEFAULT 0 NOT NULL,
          `tokens_cache_write` integer DEFAULT 0 NOT NULL,
          `revert` text,
          `permission` text,
          `agent` text,
          `model` text,
          `time_created` integer NOT NULL,
          `time_updated` integer NOT NULL,
          `time_busy` integer,
          `time_idle` integer,
          `time_viewed` integer,
          `idle_outcome` text,
          `time_compacting` integer,
          `time_archived` integer,
          `time_suspended` integer,
          `resume_attempts` integer DEFAULT 0 NOT NULL,
          CONSTRAINT `fk_session_v2_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
        );
CREATE INDEX `session_v2_project_idx` ON `session_v2` (`project_id`);
CREATE INDEX `session_v2_workspace_idx` ON `session_v2` (`workspace_id`);
CREATE INDEX `session_v2_parent_idx` ON `session_v2` (`parent_id`);
CREATE INDEX `session_v2_time_suspended_idx` ON `session_v2` (`time_suspended`) WHERE "session_v2"."time_suspended" is not null;
CREATE TABLE `session_message` (
          `id` text PRIMARY KEY,
          `session_id` text NOT NULL,
          `type` text NOT NULL,
          `seq` integer NOT NULL,
          `time_created` integer NOT NULL,
          `time_updated` integer NOT NULL,
          `data` text NOT NULL,
          CONSTRAINT `fk_session_message_session_id_session_v2_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session_v2`(`id`) ON DELETE CASCADE
        );
CREATE UNIQUE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);
CREATE INDEX `session_message_session_type_seq_idx` ON `session_message` (`session_id`,`type`,`seq`);
CREATE INDEX `session_message_session_time_created_id_idx` ON `session_message` (`session_id`,`time_created`,`id`);
CREATE INDEX `session_message_time_created_idx` ON `session_message` (`time_created`);
CREATE TABLE `session_part` (
          `message_id` text NOT NULL,
          `session_id` text NOT NULL,
          `ordinal` integer NOT NULL,
          `type` text NOT NULL,
          `call_id` text,
          `time_created` integer NOT NULL,
          `time_updated` integer NOT NULL,
          `data` text NOT NULL,
          CONSTRAINT `session_part_pk` PRIMARY KEY(`message_id`, `ordinal`),
          CONSTRAINT `fk_session_part_message_id_session_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `session_message`(`id`) ON DELETE CASCADE,
          CONSTRAINT `fk_session_part_session_id_session_v2_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session_v2`(`id`) ON DELETE CASCADE
        );
CREATE INDEX `session_part_session_message_idx` ON `session_part` (`session_id`,`message_id`,`ordinal`);
INSERT INTO session_v2 VALUES('ses_e26ba161bffehdrt84wmSzpe2q','0d6679fb59447722dadb26aceff7d764be2574ac',NULL,NULL,NULL,NULL,'happy-nebula','/work','','Listing current folder files','2.3.0',NULL,NULL,NULL,NULL,NULL,NULL,0.0,6855,100,70,18432,0,NULL,NULL,NULL,'{"id":"big-pickle","providerID":"opencode"}',1794646600207,1794646727380,1794646725660,1794646727381,NULL,'succeeded',NULL,NULL,NULL,0);
INSERT INTO session_message VALUES('msg_1d945ea23001b7ecrpxtPXOg6i','ses_e26ba161bffehdrt84wmSzpe2q','user',4,1794646600288,1794646600288,'{"time":{"created":1794646600288},"text":"Use a tool to list the files in the current folder, then reply with their names only.","files":[]}');
INSERT INTO session_message VALUES('msg_1d945ea68001iHBUSUWPQlOfJA','ses_e26ba161bffehdrt84wmSzpe2q','assistant',7,1794646600298,1794646602729,'{"time":{"created":1794646600298,"firstToken":1794646602297,"streamed":1794646602724,"completed":1794646602729},"agent":"build","model":{"id":"big-pickle","providerID":"opencode","variant":"default"},"content":[{"type":"tool","id":"call_49d3c06525b54181ab313291","name":"read","executed":false,"state":{"status":"completed","input":{"path":"/work"},"content":[{"type":"text","text":"Read directory /work, entries 1-1\nnotes.txt"}],"metadata":{"truncated":false}},"time":{"created":1794646602300,"ran":1794646602723,"completed":1794646602727}}],"finish":"tool-calls","rawFinish":"tool_calls","cost":0,"tokens":{"input":6364,"output":86,"reasoning":0,"cache":{"read":1792,"write":0}}}');
INSERT INTO session_message VALUES('msg_1d945f3ec001dRtAS4QxCyZDl1','ses_e26ba161bffehdrt84wmSzpe2q','assistant',15,1794646602733,1794646604306,'{"time":{"created":1794646602733,"firstToken":1794646604301,"streamed":1794646604305,"completed":1794646604306},"agent":"build","model":{"id":"big-pickle","providerID":"opencode","variant":"default"},"content":[{"type":"text","text":"notes.txt"}],"finish":"stop","rawFinish":"stop","cost":0,"tokens":{"input":249,"output":4,"reasoning":0,"cache":{"read":8064,"write":0}}}');
INSERT INTO session_message VALUES('msg_1d945fa14001MIkOasu8GkQh1T','ses_e26ba161bffehdrt84wmSzpe2q','idle',21,1794646604308,1794646604308,'{"time":{"created":1794646604308},"outcome":"succeeded"}');
INSERT INTO session_message VALUES('msg_1d947d3c7001pB6JtKhbYgAfuR','ses_e26ba161bffehdrt84wmSzpe2q','user',24,1794646725664,1794646725664,'{"time":{"created":1794646725664},"text":"What file name did you just list? Answer with the name only.","files":[]}');
INSERT INTO session_message VALUES('msg_1d947d42400158DMyQrCe1u7bV','ses_e26ba161bffehdrt84wmSzpe2q','assistant',25,1794646725671,1794646727380,'{"time":{"created":1794646725671,"firstToken":1794646727376,"streamed":1794646727379,"completed":1794646727380},"agent":"build","model":{"id":"big-pickle","providerID":"opencode","variant":"default"},"content":[{"type":"text","text":"notes.txt"}],"finish":"stop","rawFinish":"stop","cost":0,"tokens":{"input":142,"output":4,"reasoning":0,"cache":{"read":8192,"write":0}}}');
INSERT INTO session_message VALUES('msg_1d947dad5002VwaDMKBlBr3kqN','ses_e26ba161bffehdrt84wmSzpe2q','idle',31,1794646727381,1794646727382,'{"time":{"created":1794646727381},"outcome":"succeeded"}');
