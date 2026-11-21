FROM postgres:18
WORKDIR /migration
COPY scripts/migrate-to-neon.sh /migration/migrate-to-neon.sh
COPY scripts/migration-runner.js /migration/migration-runner.js
RUN chmod 700 /migration/migrate-to-neon.sh
CMD ["node", "/migration/migration-runner.js"]
