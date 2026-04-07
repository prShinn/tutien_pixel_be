package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.portalEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PortalRepository extends JpaRepository<portalEntity, Integer> {
    // Tìm kiếm theo code (vì code là unique)
    Optional<portalEntity> findByCode(String code);
    List<portalEntity> findAllByMapCode(String mapCode);
}
