import { ArrowRight, FileText, Newspaper } from "lucide-react";
import { FaGithub, FaXTwitter } from "react-icons/fa6";
import { Link } from "react-router-dom";
import { openExternalLink } from "@/platform/openExternalLink";
import { Button } from "@/ui";
import { Card } from "@/ui";

export type LatestPost = {
  date: string;
  tag: string;
  title: string;
};

export type LatestChangelog = {
  changes: string[];
  date: string;
  summary: string;
  version: string;
};

export type HomeFooterProps = {
  latestChangelog: LatestChangelog;
  latestPost: LatestPost | null;
};
