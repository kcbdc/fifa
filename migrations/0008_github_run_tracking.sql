-- v21: GitHub Actions 실행 ID를 저장해 단계별(step) 진행률을 조회할 수 있게 함
ALTER TABLE model_runs ADD COLUMN github_run_id TEXT;
ALTER TABLE model_runs ADD COLUMN github_run_url TEXT;
