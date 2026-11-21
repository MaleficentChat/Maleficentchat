FROM postgres:18
WORKDIR /migration
COPY scripts/migrate-to-neon.sh /migration/migrate-to-neon.sh
RUN chmod 700 /migration/migrate-to-neon.sh
CMD ["/migration/migrate-to-neon.sh"]
